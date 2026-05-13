import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevMachineEngine, type InteractionPresentationRequest } from "./engine.ts";
import { RIGKIT_STATE_SCHEMA_VERSION } from "./db/index.ts";
import { createStateStore } from "./state.ts";
import type {
  BaseProviderPlugin,
  ProviderRuntimeContext,
  SshConnection,
  WorkflowProviderController,
} from "./provider/types.ts";
import type { DevMachineEvent, ExecResult, JsonValue, WorkspaceRecord } from "./types.ts";

describe("DevMachineEngine workflow runtime", () => {
  test("plans, applies graph nodes, reuses graph cache, and forks workspaces", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        const base = app.sequence("base").task("first", async ({ runtime, test }) => {
          runtime.log("preparing base\\n", { label: "setup" });
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
            onOpen: async ({ providers, workspace, ctx, providerContext }) => {
              if (ctx.summary !== "right-ready") throw new Error("missing final context on open");
              if (providerContext.authority !== "fake-authority") throw new Error("missing provider context on open");
              const vm = providers.test.fromWorkspace(workspace);
              await vm.exec("touch /tmp/open-" + workspace.name, { name: "mark workspace open" });
            },
          })
          .operation("mark", {
            requiredHostCapabilities: [{ id: "cmux.open", schemaHash: "sha256:cmux-open-schema" }],
            input: (workflow) =>
              workflow
                .workspaceInput({ name: "workspace", position: 0 })
                .extend({
                  label: workflow.string({ defaultValue: "marked" }),
                }),
            run: async ({ input, providers, local }) => {
              const vm = providers.test.fromWorkspace(input.workspace);
              await vm.exec("touch /tmp/mark-" + input.workspace.name, { name: "mark via operation" });
              await local.open("mark://" + input.workspace.name);
              return {
                workspace: input.workspace.name,
                label: input.label,
                cwd: input.workspace.cwd ?? null,
              };
            },
          });
      `,
    );

    const opened: string[] = [];
    const events: DevMachineEvent[] = [];
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
    engine.onEvent((event) => events.push(event));

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
    expect(events).toContainEqual({
      type: "log.output",
      nodePath: "base.first",
      stream: "info",
      label: "setup",
      data: "preparing base\n",
    });
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

    const markOperation = engine.listOperations().find((operation) => operation.id === "mark");
    expect(markOperation?.requiredHostCapabilities).toEqual([
      { id: "cmux.open", schemaHash: "sha256:cmux-open-schema" },
    ]);
    const marked = await engine.runOperation({ operation: "mark", input: { workspace: "work" } });
    expect(marked).toEqual({ workspace: "work", label: "marked", cwd: "/workspace/repo" });
    expect(opened).toEqual(["vscode://work", "mark://work"]);
    expect(provider.hasFile("workspace-work", "/tmp/mark-work")).toBe(true);

    const terminal = await engine.attachTerminal({ workspaceOrVmId: "work", printOnly: true });
    expect(terminal.command).toBe("ssh workspace-work");
    expect(provider.workspaceContextResourceIds).toEqual(["workspace-work", "workspace-work"]);
    expect(provider.hasFile("workspace-work", "/tmp/open-work")).toBe(true);

    const workspaceSnapshot = await engine.snapshotWorkspace({ workspace: "work", label: "verified-work" });
    expect(workspaceSnapshot.metadata.snapshotId).toBe("snap-3");
    expect(workspaceSnapshot.nodeName).toBe("verified-work");

    await engine.deleteWorkspace({ workspace: "work" });
    expect(engine.listWorkspaces()).toHaveLength(0);
  });

  test("creates workspaces from config create callbacks and exposes persisted workspace data", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineConfig, defineProvider, sequence } from "${import.meta.dir}/index.ts";

        const test = defineProvider("test", { token: "test-key" });

        const root = sequence("create-test")
          .step("prepare", async ({ providers }) => {
            const vm = await providers.test.createVm();
            await vm.exec("touch /tmp/template", { name: "prepare template" });
            return {
              vm: await vm.snapshotRef(),
              repoPath: "/workspace/repo",
            };
          })
          .create(async ({ ctx, name, providers }) => {
            const vm = await providers.test.fromSnapshot(ctx.vm);
            await vm.exec("touch /tmp/create-" + name, { name: "create workspace" });
            return {
              name,
              vmId: vm.vmId,
              sourceSnapshot: ctx.vm,
              repoPath: ctx.repoPath,
              ready: true,
            };
          })
          .operation("inspect", {
            input: (workflow) => workflow.workspaceInput({ name: "workspace", position: 0 }),
            run: async ({ input, local }) => {
              await local.open("created://" + input.workspace.name);
              return {
                vmId: input.workspace.data.vmId,
                repoPath: input.workspace.data.repoPath,
                ready: input.workspace.data.ready,
              };
            },
          });

        export default defineConfig({
          providers: { test },
          workflows: { root },
        });
      `,
    );

    const opened: string[] = [];
    const provider = new FakeWorkflowProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
      local: {
        open: async (target) => {
          opened.push(target);
        },
      },
    });

    await engine.load();
    const projectInfo = engine.getProjectInfo();
    expect(projectInfo.workflow?.createsWorkspace).toBe(true);
    expect(projectInfo.workflows.map((workflow) => workflow.name)).toEqual(["create-test"]);
    expect(engine.listOperations().map((operation) => operation.id)).toEqual(["inspect"]);

    const workspace = await engine.fork({ name: "created" });
    expect(workspace.name).toBe("created");
    expect(workspace.providerId).toBe("config");
    expect(workspace.resourceId).toBe("vm-2");
    expect(workspace.metadata).toMatchObject({
      name: "created",
      vmId: "vm-2",
      repoPath: "/workspace/repo",
      ready: true,
    });
    expect(provider.hasFile("vm-2", "/tmp/create-created")).toBe(true);

    const inspected = await engine.runOperation({ operation: "inspect", input: { workspace: "created" } });
    expect(inspected).toEqual({
      vmId: "vm-2",
      repoPath: "/workspace/repo",
      ready: true,
    });
    expect(opened).toEqual(["created://created"]);
  });

  test("loads multiple workflows from defineConfig", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineConfig, sequence } from "${import.meta.dir}/index.ts";

        const api = sequence("api").step("ready", async () => ({ api: true }));
        const web = sequence("web").step("ready", async () => ({ web: true }));

        export default defineConfig({
          providers: {},
          workflows: { api, web },
        });
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
    });

    await engine.load();

    expect(engine.listWorkflowSummaries().map((workflow) => workflow.name)).toEqual(["api", "web"]);
    expect(engine.getProjectInfo().workflow).toBeUndefined();
    await expect(engine.plan()).rejects.toThrow("Multiple workflows are defined");
    expect((await engine.plan({ workflow: "api" })).workflow).toBe("api");
  });

  test("creates state through an injectable state service factory", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    const statePath = join(projectDir, "custom-state.sqlite");
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineConfig, sequence } from "${import.meta.dir}/index.ts";

        const root = sequence("factory-test").step("ready", async () => ({ ready: true }));

        export default defineConfig({
          providers: {},
          workflows: { root },
        });
      `,
    );

    const configPath = join(projectDir, "rig.config.ts");
    const calls: Array<{ projectDir: string; configPath?: string; statePath?: string }> = [];
    const engine = await createDevMachineEngine({
      projectDir,
      statePath,
      providerFactory: () => new FakeWorkflowProvider(),
      stateFactory: (options) => {
        calls.push({
          projectDir: options.projectDir,
          configPath: options.configPath,
          statePath: options.statePath,
        });
        return createStateStore(options);
      },
    });

    await engine.load();

    expect(calls).toEqual([{ projectDir, configPath, statePath }]);
    expect(engine.getProjectInfo().statePath).toBe(statePath);

    const state = createStateStore({ projectDir, statePath: join(projectDir, "provided-state.sqlite") });
    const engineWithState = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
      state,
      stateFactory: () => {
        throw new Error("stateFactory should not be called when state is provided");
      },
    });

    await engineWithState.load();
    expect(engineWithState.getProjectInfo().statePath).toBe(state.path);
  });

  test("resets stale state before applying the Drizzle push schema", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    const statePath = join(projectDir, ".rigkit", "state.sqlite");
    mkdirSync(join(projectDir, ".rigkit"));
    const legacy = new Database(statePath, { create: true });
    legacy.run(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        vm_id TEXT NOT NULL,
        machine TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      )
    `);
    legacy
      .query(`
        INSERT INTO workspaces (
          id, name, provider_id, vm_id, machine, snapshot_id, created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "workspace-1",
        "demo",
        "freestyle",
        "vm-1",
        "smoke",
        "snap-1",
        "2026-05-10T00:00:00.000Z",
        "2026-05-10T00:00:00.000Z",
        JSON.stringify({ ready: true }),
      );
    legacy.close();

    const state = createStateStore({ projectDir, statePath });
    const result = await state.syncSchema();
    const workspaces = state.listWorkspaces();

    expect(result.applied).toEqual([RIGKIT_STATE_SCHEMA_VERSION]);
    expect(result.hasDataLoss).toBe(true);
    expect(result.warnings.some((warning) => warning.startsWith("Reset Rigkit state database after Drizzle push failed"))).toBe(
      true,
    );
    expect(workspaces).toEqual([]);

    const now = new Date().toISOString();
    state.saveWorkspace({
      id: "workspace-2",
      name: "demo",
      providerId: "freestyle",
      workflow: "smoke",
      resourceId: "resource-2",
      snapshotId: "snap-2",
      sourceRef: { snapshotId: "snap-2" },
      context: { ready: true },
      createdAt: now,
      updatedAt: now,
      metadata: { ready: true },
    });
    expect(state.getWorkspace("demo")).toMatchObject({
      name: "demo",
      workflow: "smoke",
      resourceId: "resource-2",
    });
  });

  test("stores provider JSON state in Rigkit-owned provider storage", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    const plugin: BaseProviderPlugin = {
      providerId: "test",
      createProvider({ storage }) {
        storage.set("ready", { value: "provider" });
        return new FakeWorkflowProvider();
      },
    };

    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("provider-storage", {
          providers: {
            test: defineProvider("test", {}),
          },
        });

        export default app.sequence("root").task("ready", async () => ({ ready: true }));
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providers: [plugin],
    });

    await engine.load();
    await engine.plan();

    const statePath = engine.getProjectInfo().statePath;
    const main = new Database(statePath);
    const mainTables = main
      .query<{ name: string }, []>("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => row.name);

    expect(mainTables).toContain("workspaces");
    expect(mainTables).toContain("provider_state");
    expect(mainTables).toContain("runtime_metadata");
    expect(mainTables).not.toContain("provider_local_state");

    const row = main
      .query<{ value_json: string }, []>(
        "select value_json from provider_state where provider_id = 'test' and key = 'ready'",
      )
      .get();
    const metadataRows = main
      .query<{ key: string; value_json: string }, []>(
        "select key, value_json from runtime_metadata order by key",
      )
      .all();
    main.close();

    expect(row ? JSON.parse(row.value_json).value : undefined).toBe("provider");
    const metadata = Object.fromEntries(metadataRows.map((item) => [item.key, JSON.parse(item.value_json)]));
    expect(metadata["state.schemaVersion"]).toBe(RIGKIT_STATE_SCHEMA_VERSION);
    expect(metadata["project.dir"]).toBe(projectDir);
    expect(metadata["config.path"]).toBe(join(projectDir, "rig.config.ts"));
  });

  test("rejects task outputs that are not JSON serializable", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

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
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

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
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

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
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    const previousToken = process.env.RIGKIT_TEST_PROVIDER_TOKEN;
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: () => process.env.RIGKIT_TEST_PROVIDER_TOKEN }),
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
      process.env.RIGKIT_TEST_PROVIDER_TOKEN = "one";
      const first = await createDevMachineEngine({
        projectDir,
        providerFactory: () => provider,
      });
      await first.load();
      await first.apply();
      expect((await first.plan()).cachedNodeCount).toBe(1);

      process.env.RIGKIT_TEST_PROVIDER_TOKEN = "two";
      const second = await createDevMachineEngine({
        projectDir,
        providerFactory: () => provider,
      });
      await second.load();
      expect((await second.plan()).cachedNodeCount).toBe(0);
    } finally {
      if (previousToken === undefined) {
        delete process.env.RIGKIT_TEST_PROVIDER_TOKEN;
      } else {
        process.env.RIGKIT_TEST_PROVIDER_TOKEN = previousToken;
      }
    }
  });

  test("treats cached output schema failures as cache misses", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-"));
    const previousMode = process.env.RIGKIT_SCHEMA_MODE;
    writeFileSync(
      join(projectDir, "rig.config.ts"),
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test", {
          providers: {
            test: defineProvider("test", { token: "test-key" }),
          },
        });

        const schema = {
          parse(value) {
            if (!value || typeof value !== "object") throw new Error("not an object");
            if (process.env.RIGKIT_SCHEMA_MODE === "next" && value.next !== true) {
              throw new Error("missing next");
            }
            return value;
          },
        };

        export default app.sequence("schema").task("value", { output: schema }, async () => {
          return process.env.RIGKIT_SCHEMA_MODE === "next"
            ? { value: "ok", next: true }
            : { value: "ok" };
        });
      `,
    );

    try {
      process.env.RIGKIT_SCHEMA_MODE = "old";
      const first = await createDevMachineEngine({
        projectDir,
        providerFactory: () => new FakeWorkflowProvider(),
      });
      await first.load();
      await first.apply();
      expect((await first.plan()).cachedNodeCount).toBe(1);

      process.env.RIGKIT_SCHEMA_MODE = "next";
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
        delete process.env.RIGKIT_SCHEMA_MODE;
      } else {
        process.env.RIGKIT_SCHEMA_MODE = previousMode;
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
