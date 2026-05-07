import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevMachineEngine, type InteractionPresentationRequest } from "./engine.ts";
import type {
  ProviderRuntimeContext,
  SshConnection,
  WorkflowProviderController,
} from "./provider/types.ts";
import type { ExecResult, JsonValue, WorkspaceRecord } from "@freestyle-sh/fdev-sdk";

describe("DevMachineEngine workflow runtime", () => {
  test("plans, applies graph nodes, reuses graph cache, and forks workspaces", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        const base = app.sequence("base").task("first", async ({ test }) => {
          const vm = await test.createVm();
          await vm.exec("touch /tmp/first", { name: "touch first" });
          if (!(await vm.exists("/tmp/first"))) throw new Error("first was not created");
          return { first: true, vm: await vm.snapshotRef() };
        });

        const left = app.sequence("left").task("second", async ({ ctx, test }) => {
          if (!ctx.first) throw new Error("missing first context");
          const vm = await test.fromSnapshot(ctx.vm);
          await vm.exec("touch /tmp/second", { name: "touch second" });
          return { second: true, vm: await vm.snapshotRef() };
        });

        const right = app.sequence("right").task("data", async ({ ctx }) => {
          if (!ctx.first) throw new Error("missing first context");
          return { data: "right-ready" };
        });

        export default app
          .sequence("root")
          .add(base)
          .parallel({ left, right })
          .task("join", async ({ ctx }) => {
            if (!ctx.left.second) throw new Error("missing left context");
            if (ctx.right.data !== "right-ready") throw new Error("missing right context");
            return { vm: ctx.left.vm, summary: ctx.right.data };
          })
          .workspace({
            source: (ctx) => ctx.vm,
            cwd: "/workspace/repo",
            onCreated: async ({ providers, workspace, ctx, local, providerContext }) => {
              if (ctx.summary !== "right-ready") throw new Error("missing final context");
              if (providerContext.authority !== "fake-authority") throw new Error("missing provider context");
              const vm = providers.test.fromWorkspace(workspace);
              await vm.exec("touch /tmp/workspace-" + workspace.name, { name: "mark workspace" });
              await local.open("vscode://" + workspace.name);
            },
          });
      `,
    );

    const opened: string[] = [];
    const provider = new FakeWorkflowProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: async () => provider,
      local: {
        open: async (target) => {
          opened.push(target);
        },
      },
    });

    await engine.load();

    const initial = await engine.plan();
    expect(initial.workflow).toBe("test");
    expect(initial.cachedNodeCount).toBe(0);
    expect(initial.nodeCount).toBe(4);
    expect(initial.nodes.map((node) => node.path)).toEqual([
      "base.first",
      "left.second",
      "right.data",
      "join",
    ]);

    const applied = await engine.apply();
    expect(applied.snapshotId).toBe("snap-2");
    expect(provider.snapshots).toHaveLength(2);
    expect(engine.listNodeRuns()).toHaveLength(4);

    const cached = await engine.plan();
    expect(cached.cachedNodeCount).toBe(4);
    expect(cached.finalContext?.summary).toBe("right-ready");

    const workspace = await engine.fork({ name: "work" });
    expect(workspace.snapshotId).toBe("snap-2");
    expect(workspace.name).toBe("work");
    expect(workspace.resourceId).toBe("workspace-work");
    expect(engine.listWorkspaces()).toHaveLength(1);
    expect(opened).toEqual(["vscode://work"]);
    expect(provider.workspaceContextResourceIds).toEqual(["workspace-work"]);
    expect(provider.hasFile("workspace-work", "/tmp/workspace-work")).toBe(true);

    const workspaceSnapshot = await engine.snapshotWorkspace({ workspace: "work", label: "verified-work" });
    expect(workspaceSnapshot.metadata.snapshotId).toBe("snap-3");
    expect(workspaceSnapshot.nodeName).toBe("verified-work");

    await engine.deleteWorkspace({ workspace: "work" });
    expect(engine.listWorkspaces()).toHaveLength(0);
  });

  test("rejects task outputs that are not JSON serializable", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        export default app.sequence("bad").task("returns-function", async () => {
          return { fn: () => "nope" };
        });
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
    });

    await engine.load();
    await expect(engine.apply()).rejects.toThrow("must be JSON-serializable");
  });

  test("routes terminal interactions through provider runtimes", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        export default app.sequence("auth").task("login", async ({ test }) => {
          const result = await test.openTerminal("GitHub auth", "gh auth login");
          return { finished: result.finished };
        });
      `,
    );

    const interactions: InteractionPresentationRequest[] = [];
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
      interaction: {
        present: async (request) => {
          interactions.push(request);
        },
      },
    });

    await engine.load();
    const applied = await engine.apply();

    expect(interactions).toEqual([
      {
        nodePath: "login",
        id: "fake-terminal",
        title: "GitHub auth",
        url: "http://127.0.0.1/fake-terminal",
        instructions: undefined,
      },
    ]);
    expect(applied.context.finished).toBe(true);
  });

  test("waits for provider-owned interaction completion before resuming tasks", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        export default app.sequence("auth").task("login", async ({ test }) => {
          const result = await test.openTerminal("GitHub auth", "gh auth login");
          return { finished: result.finished };
        });
      `,
    );

    let complete!: (result: { finished: true }) => void;
    const completed = new Promise<{ finished: true }>((resolve) => {
      complete = resolve;
    });
    const provider = new FakeWorkflowProvider({
      terminalCompleted: completed,
    });
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
      interaction: {
        present: async () => {},
      },
    });

    await engine.load();
    let applied: Awaited<ReturnType<typeof engine.apply>> | undefined;
    const applying = engine.apply().then((result) => {
      applied = result;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(applied).toBeUndefined();
    expect(provider.terminalStopped).toBe(0);

    complete({ finished: true });
    await applying;

    expect(applied?.context.finished).toBe(true);
    expect(provider.terminalStopped).toBe(1);
  });

  test("provider config contributes to the workflow cache fingerprint", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    const previousToken = process.env.FDEV_TEST_PROVIDER_TOKEN;
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: () => process.env.FDEV_TEST_PROVIDER_TOKEN }),
          },
        });

        export default app.sequence("setup").task("touch", async ({ test }) => {
          const vm = await test.createVm();
          await vm.exec("touch /tmp/setup", { name: "touch setup" });
          return { vm: await vm.snapshotRef() };
        });
      `,
    );

    try {
      const provider = new FakeWorkflowProvider();
      process.env.FDEV_TEST_PROVIDER_TOKEN = "one";
      const first = await createDevMachineEngine({
        projectDir,
        providerFactory: () => provider,
      });
      await first.load();
      await first.apply();
      expect((await first.plan()).cachedNodeCount).toBe(1);

      process.env.FDEV_TEST_PROVIDER_TOKEN = "two";
      const second = await createDevMachineEngine({
        projectDir,
        providerFactory: () => provider,
      });
      await second.load();
      expect((await second.plan()).cachedNodeCount).toBe(0);
    } finally {
      if (previousToken === undefined) {
        delete process.env.FDEV_TEST_PROVIDER_TOKEN;
      } else {
        process.env.FDEV_TEST_PROVIDER_TOKEN = previousToken;
      }
    }
  });

  test("treats cached output schema failures as cache misses", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    const previousMode = process.env.FDEV_SCHEMA_MODE;
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        const schema = {
          parse(value) {
            if (!value || typeof value !== "object") throw new Error("not an object");
            if (process.env.FDEV_SCHEMA_MODE === "next" && value.next !== true) {
              throw new Error("missing next");
            }
            return value;
          },
        };

        export default app.sequence("schema").task("value", { output: schema }, async () => {
          return process.env.FDEV_SCHEMA_MODE === "next"
            ? { value: "ok", next: true }
            : { value: "ok" };
        });
      `,
    );

    try {
      process.env.FDEV_SCHEMA_MODE = "old";
      const first = await createDevMachineEngine({
        projectDir,
        providerFactory: () => new FakeWorkflowProvider(),
      });
      await first.load();
      await first.apply();
      expect((await first.plan()).cachedNodeCount).toBe(1);

      process.env.FDEV_SCHEMA_MODE = "next";
      const second = await createDevMachineEngine({
        projectDir,
        providerFactory: () => new FakeWorkflowProvider(),
      });
      await second.load();
      const plan = await second.plan();
      expect(plan.cachedNodeCount).toBe(0);
      expect(plan.nodes[0]?.status).toBe("pending");
    } finally {
      if (previousMode === undefined) {
        delete process.env.FDEV_SCHEMA_MODE;
      } else {
        process.env.FDEV_SCHEMA_MODE = previousMode;
      }
    }
  });
});

type FakeSnapshotRef = {
  provider: "test";
  kind: "vmSnapshot";
  snapshotId: string;
};

type FakeVm = {
  vmId: string;
  exec(command: string, options?: { name?: string }): Promise<ExecResult>;
  probe(command: string, options?: { name?: string }): Promise<ExecResult>;
  exists(path: string): Promise<boolean>;
  snapshotRef(): Promise<FakeSnapshotRef>;
};

type FakeRuntime = {
  createVm(): Promise<FakeVm>;
  fromSnapshot(ref: FakeSnapshotRef): Promise<FakeVm>;
  fromWorkspace(workspace: Pick<WorkspaceRecord, "resourceId">): FakeVm;
  openTerminal(label: string, command: string): Promise<{ finished: true }>;
};

class FakeWorkflowProvider implements WorkflowProviderController<FakeRuntime, { authority: string }> {
  readonly providerId = "test";
  snapshots: FakeSnapshotRef[] = [];
  workspaceContextResourceIds: string[] = [];
  private nextVm = 1;
  private files = new Map<string, Set<string>>();
  terminalStopped = 0;

  constructor(
    private readonly options: {
      terminalCompleted?: Promise<{ finished: true }>;
    } = {},
  ) {}

  runtime(context: ProviderRuntimeContext): FakeRuntime {
    return {
      createVm: async () => this.createVm(context),
      fromSnapshot: async () => this.createVm(context),
      fromWorkspace: (workspace) => this.vmRuntime({ vmId: workspace.resourceId }, context),
      openTerminal: async (label, command) => {
        const completed = this.options.terminalCompleted ?? Promise.resolve({ finished: true as const });
        return await context.interaction.present({
          id: "fake-terminal",
          title: label,
          url: "http://127.0.0.1/fake-terminal",
          completed,
          stop: () => {
            this.terminalStopped += 1;
          },
        });
      },
    };
  }

  validateArtifact(ref: JsonValue): boolean {
    return isFakeSnapshotRef(ref);
  }

  workspace = {
    canUse: (ref: JsonValue) => isFakeSnapshotRef(ref),
    createWorkspace: async (ref: JsonValue, input: { name: string }) => {
      if (!isFakeSnapshotRef(ref)) throw new Error("bad ref");
      const resourceId = `workspace-${input.name}`;
      this.files.set(resourceId, new Set());
      return {
        providerId: "test",
        resourceId,
        snapshotId: ref.snapshotId,
        sourceRef: ref,
      };
    },
    deleteWorkspace: async () => {},
    snapshotWorkspace: async (workspace: WorkspaceRecord) => {
      const ref = this.createSnapshot({ vmId: workspace.resourceId });
      return {
        providerId: "test",
        resourceId: workspace.resourceId,
        snapshotId: ref.snapshotId,
        sourceRef: ref,
      };
    },
    ssh: async (workspaceOrResourceId: string): Promise<SshConnection> => ({
      kind: "ssh",
      host: "fake",
      username: workspaceOrResourceId,
      auth: { type: "token", token: "fake" },
      command: `ssh ${workspaceOrResourceId}`,
    }),
    workspaceContext: (workspace: WorkspaceRecord) => {
      this.workspaceContextResourceIds.push(workspace.resourceId);
      return { authority: "fake-authority" };
    },
  };

  hasFile(vmId: string, path: string): boolean {
    return this.files.get(vmId)?.has(path) ?? false;
  }

  private async createVm(context: ProviderRuntimeContext): Promise<FakeVm> {
    const vm = { vmId: `vm-${this.nextVm++}` };
    this.files.set(vm.vmId, new Set());
    context.emit({ type: "vm.created", providerId: "test", vmId: vm.vmId });
    return this.vmRuntime(vm, context);
  }

  private vmRuntime(vm: { vmId: string }, _context: ProviderRuntimeContext): FakeVm {
    return {
      vmId: vm.vmId,
      exec: async (command) => this.exec(vm.vmId, command, true),
      probe: async (command) => this.exec(vm.vmId, command, false),
      exists: async (path) => this.hasFile(vm.vmId, path),
      snapshotRef: async () => this.createSnapshot(vm),
    };
  }

  private exec(vmId: string, command: string, throwOnFailure: boolean): ExecResult {
    const files = this.files.get(vmId)!;
    const touch = /^touch (.+)$/.exec(command);
    if (touch) files.add(touch[1]!);

    const exists = /^test -e (.+)$/.exec(command);
    if (exists) {
      const path = exists[1]!.replace(/^'|'$/g, "");
      return result(files.has(path));
    }

    const output = result(true);
    if (throwOnFailure && !output.ok) throw new Error("command failed");
    return output;
  }

  private createSnapshot(vm: { vmId: string }): FakeSnapshotRef {
    const snapshot = {
      provider: "test" as const,
      kind: "vmSnapshot" as const,
      snapshotId: `snap-${this.snapshots.length + 1}`,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }
}

function result(ok: boolean): ExecResult {
  return { stdout: "", stderr: "", exitCode: ok ? 0 : 1, ok };
}

function isFakeSnapshotRef(value: unknown): value is FakeSnapshotRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as FakeSnapshotRef).provider === "test" &&
      (value as FakeSnapshotRef).kind === "vmSnapshot" &&
      typeof (value as FakeSnapshotRef).snapshotId === "string",
  );
}
