import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JsonValue, WorkspaceRecord } from "@freestyle-sh/fdev-sdk";

export type SnapshotRecord = {
  id: string;
  machine: string;
  machineKey: string;
  prefixKeys: string[];
  prefixLength: number;
  snapshotId: string;
  sourceVmId: string;
  createdAt: string;
  migrationName: string;
  context: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
};

export type FdevState = {
  version: 1;
  snapshots: SnapshotRecord[];
  workspaces: Record<string, WorkspaceRecord>;
};

export class StateStore {
  readonly path: string;

  constructor(projectDir: string) {
    this.path = join(projectDir, ".fdev", "state.json");
  }

  read(): FdevState {
    if (!existsSync(this.path)) {
      return { version: 1, snapshots: [], workspaces: {} };
    }

    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as FdevState;
    return {
      version: 1,
      snapshots: parsed.snapshots ?? [],
      workspaces: parsed.workspaces ?? {},
    };
  }

  write(state: FdevState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`);
  }

  update(mutator: (state: FdevState) => void): FdevState {
    const state = this.read();
    mutator(state);
    this.write(state);
    return state;
  }
}
