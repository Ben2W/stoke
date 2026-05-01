import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevMachineEngine } from "./engine.ts";
import type { DevMachineProvider, SnapshotHandle, TerminalHandle, VmHandle } from "./provider/types.ts";
import type { ExecOptions, ExecResult } from "./types.ts";

describe("DevMachineEngine", () => {
  test("plans, applies migrations, reuses cached prefixes, and forks workspaces", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-"));
    writeFileSync(
      join(projectDir, "fdev.config.ts"),
      `
        import { defineDevMachine, defineMigration } from "${import.meta.dir}/index.ts";

        const first = defineMigration("first", async (c) => {
          c.set("first", true);
          await c.step.run("touch first", "touch /tmp/first");
          await c.step.assert("first exists", async ({ vm }) => vm.exists("/tmp/first"));
        });

        const second = defineMigration("second", async (c) => {
          c.require("first");
          await c.step.run("touch second", "touch /tmp/second");
        });

        export default defineDevMachine({
          name: "test",
          apiKey: "test-key",
          image: "ubuntu-24.04",
          migrations: [first, second],
        });
      `,
    );

    const provider = new FakeProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
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

    await engine.deleteWorkspace({ workspace: "work" });
    expect(engine.listWorkspaces()).toHaveLength(0);
  });
});

class FakeProvider implements DevMachineProvider {
  snapshots: SnapshotHandle[] = [];
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

  async forkVm(): Promise<VmHandle> {
    return this.createHandle();
  }

  async openTerminal(): Promise<TerminalHandle> {
    return { command: "ssh fake" };
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
