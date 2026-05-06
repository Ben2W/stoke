import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevMachineEngine, type TerminalInteractionRequest } from "./engine.ts";
import type { DevMachineProvider, SnapshotHandle, SshConnection, VmHandle } from "./provider/types.ts";
import type { ExecOptions, ExecResult } from "@freestyle-sh/fdev-sdk";

describe("DevMachineEngine", () => {
  test("plans, applies steps, reuses cached prefixes, and forks workspaces", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineDevMachine, defineProvider, defineStep } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const first = defineStep("first", async (c) => {
          const missing = await c.vm.probe("test -e /tmp/missing", { name: "probe missing" });
          if (missing.ok) throw new Error("probe should not report missing file as ok");
          await c.vm.exec("touch /tmp/first", { name: "touch first" });
          if (!(await c.vm.exists("/tmp/first"))) throw new Error("first was not created");
          return { first: true };
        });

        const second = defineStep("second", { dependsOn: [first] }, async (c) => {
          if (!c.ctx.steps.first) throw new Error("missing first context");
          await c.vm.exec("touch /tmp/second", { name: "touch second" });
        });

        export default defineDevMachine({
          name: "test",
          provider: defineProvider("test", { token: "test-key" }),
          steps: [first, second],
        });
      `,
    );

    const provider = new FakeProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: async () => provider,
    });

    await engine.load();

    const initial = await engine.plan();
    expect(initial.cachedPrefixLength).toBe(0);

    const applied = await engine.apply();
    expect(applied.snapshotId).toBe("snap-2");
    expect(provider.snapshots).toHaveLength(2);

    const cached = await engine.plan();
    expect(cached.cachedPrefixLength).toBe(2);

    const workspace = await engine.fork({ name: "work" });
    expect(workspace.snapshotId).toBe("snap-2");
    expect(workspace.name).toBe("work");
    expect(engine.listWorkspaces()).toHaveLength(1);

    const workspaceSnapshot = await engine.snapshotWorkspace({ workspace: "work", label: "verified-work" });
    expect(workspaceSnapshot.snapshotId).toBe("snap-3");
    expect(workspaceSnapshot.stepName).toBe("verified-work");
    expect(engine.listSnapshots()).toHaveLength(3);

    await engine.deleteWorkspace({ workspace: "work" });
    expect(engine.listWorkspaces()).toHaveLength(0);
  });

  test("exec throws on failed commands while probe returns the result", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineDevMachine, defineProvider, defineStep } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const fails = defineStep("fails", async ({ vm }) => {
          const missing = await vm.probe("test -e /tmp/missing", { name: "probe missing" });
          if (missing.ok) throw new Error("probe should not throw or pass");
          await vm.exec("test -e /tmp/missing", { name: "require missing" });
        });

        export default defineDevMachine({
          name: "test",
          provider: defineProvider("test", { token: "test-key" }),
          steps: [fails],
        });
      `,
    );

    const provider = new FakeProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
    });

    await engine.load();
    await expect(engine.apply()).rejects.toThrow('Command "require missing" failed with exit code 1');
    expect(provider.snapshots).toHaveLength(0);
  });

  test("runs workspace onCreated with step context, provider context, and local helpers", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineDevMachine, defineProvider, defineStep } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const setup = defineStep("setup", async ({ vm }) => {
          await vm.exec("touch /tmp/setup", { name: "touch setup" });
          return { repoPath: "/workspace/repo" };
        });

        export default defineDevMachine({
          name: "test",
          provider: defineProvider("test", { token: "test-key" }),
          steps: [setup],
          workspace: {
            cwd: "/workspace/repo",
            onCreated: async ({ vm, workspace, ctx, local }) => {
              if (ctx.steps.repoPath !== "/workspace/repo") throw new Error("missing step context");
              if ((ctx.provider as { vscodeAuthority?: string }).vscodeAuthority !== "fake-authority") {
                throw new Error("missing provider context");
              }
              if (workspace.cwd !== "/workspace/repo") throw new Error("missing workspace cwd");
              await vm.exec("touch /tmp/workspace-" + workspace.name, { name: "mark workspace" });
              await local.open("vscode://" + workspace.name);
            },
          },
        });
      `,
    );

    const opened: string[] = [];
    const provider = new FakeProvider();
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
    const workspace = await engine.fork({ name: "work" });

    expect(workspace.name).toBe("work");
    expect(opened).toEqual(["vscode://work"]);
    expect(provider.workspaceContextVmIds).toEqual([workspace.vmId]);
    expect(await provider.exec({ vmId: workspace.vmId }, "test -e /tmp/workspace-work")).toMatchObject({ ok: true });
  });

  test("routes terminal interactions through the configured handler", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineDevMachine, defineProvider, defineStep } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const login = defineStep("login", async ({ interact }) => {
          await interact.terminal("GitHub auth", {
            command: "gh auth login",
            instructions: "Authenticate GitHub inside the VM.",
          });
        });

        export default defineDevMachine({
          name: "test",
          provider: defineProvider("test", { token: "test-key" }),
          steps: [login],
        });
      `,
    );

    const interactions: TerminalInteractionRequest[] = [];
    const provider = new FakeProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
      interaction: {
        terminal: async (request) => {
          interactions.push(request);
        },
      },
    });

    await engine.load();
    await engine.apply();

    expect(interactions).toEqual([
      {
        step: "login",
        label: "GitHub auth",
        command: "ssh -tt -q 'fake:fake@fake'",
        remoteCommand: "gh auth login",
        instructions: "Authenticate GitHub inside the VM.",
      },
    ]);
    expect(provider.snapshots).toHaveLength(1);
  });

  test("provider config contributes to the machine cache key", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    const previousToken = process.env.FDEV_TEST_PROVIDER_TOKEN;
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineDevMachine, defineProvider, defineStep } from "${import.meta.dir}/../../fdev-sdk/src/index.ts";

        const setup = defineStep("setup", async ({ vm }) => {
          await vm.exec("touch /tmp/setup", { name: "touch setup" });
        });

        export default defineDevMachine({
          name: "test",
          provider: defineProvider("test", { token: () => process.env.FDEV_TEST_PROVIDER_TOKEN }),
          steps: [setup],
        });
      `,
    );

    try {
      const provider = new FakeProvider();
      process.env.FDEV_TEST_PROVIDER_TOKEN = "one";
      const first = await createDevMachineEngine({
        projectDir,
        providerFactory: () => provider,
      });
      await first.load();
      await first.apply();
      expect((await first.plan()).cachedPrefixLength).toBe(1);

      process.env.FDEV_TEST_PROVIDER_TOKEN = "two";
      const second = await createDevMachineEngine({
        projectDir,
        providerFactory: () => provider,
      });
      await second.load();
      expect((await second.plan()).cachedPrefixLength).toBe(0);
    } finally {
      if (previousToken === undefined) {
        delete process.env.FDEV_TEST_PROVIDER_TOKEN;
      } else {
        process.env.FDEV_TEST_PROVIDER_TOKEN = previousToken;
      }
    }
  });
});

class FakeProvider implements DevMachineProvider {
  readonly providerId = "test";
  snapshots: SnapshotHandle[] = [];
  workspaceContextVmIds: string[] = [];
  private nextVm = 1;
  private files = new Map<string, Set<string>>();

  async createVm(): Promise<VmHandle> {
    return this.createHandle();
  }

  async createVmFromSnapshot(): Promise<VmHandle> {
    return this.createHandle();
  }

  async exec(vm: VmHandle, command: string, _options?: ExecOptions): Promise<ExecResult> {
    const files = this.files.get(vm.vmId)!;
    const touch = /^touch (.+)$/.exec(command);
    if (touch) files.add(touch[1]!);

    const exists = /^test -e (.+)$/.exec(command);
    if (exists) {
      const path = exists[1]!.replace(/^'|'$/g, "");
      return result(files.has(path));
    }

    return result(true);
  }

  async readFile(): Promise<string> {
    return "";
  }

  async writeFile(): Promise<void> {}

  async snapshot(vm: VmHandle): Promise<SnapshotHandle> {
    const snapshot = {
      snapshotId: `snap-${this.snapshots.length + 1}`,
      sourceVmId: vm.vmId,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async ssh(): Promise<SshConnection> {
    return {
      kind: "ssh",
      host: "fake",
      username: "fake",
      auth: { type: "token", token: "fake" },
      command: "ssh fake",
    };
  }

  workspaceContext(vm: VmHandle): { vscodeAuthority: string } {
    this.workspaceContextVmIds.push(vm.vmId);
    return { vscodeAuthority: "fake-authority" };
  }

  async deleteVm(): Promise<void> {}

  private createHandle(): VmHandle {
    const handle = { vmId: `vm-${this.nextVm++}` };
    this.files.set(handle.vmId, new Set());
    return handle;
  }
}

function result(ok: boolean): ExecResult {
  return { stdout: "", stderr: "", exitCode: ok ? 0 : 1, ok };
}
