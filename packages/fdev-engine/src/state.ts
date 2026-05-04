import { join } from "node:path";
import { asc, desc, eq, or } from "drizzle-orm";
import type { JsonValue, WorkspaceRecord } from "@freestyle-sh/fdev-sdk";
import {
  composeFdevSchema,
  createFdevDatabase,
  syncFdevDatabaseSchema,
  type FdevDatabase,
  type FdevDatabaseSchema,
  type SchemaSyncResult,
} from "./db/index.ts";
import { snapshots, workspaces } from "./db/schema/index.ts";
import { stableJson } from "./hash.ts";

export type SnapshotRecord = {
  id: string;
  providerId: string;
  machine: string;
  machineKey: string;
  prefixKeys: string[];
  prefixLength: number;
  snapshotId: string;
  sourceVmId: string;
  createdAt: string;
  stepName: string;
  context: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
};

export class StateStore {
  readonly path: string;
  readonly db: FdevDatabase<FdevDatabaseSchema>;
  private readonly schema: FdevDatabaseSchema;
  private schemaSync?: Promise<SchemaSyncResult>;

  constructor(projectDir: string, options: { providerSchemas?: FdevDatabaseSchema[] } = {}) {
    this.path = join(projectDir, ".fdev", "state.sqlite");
    this.schema = composeFdevSchema(options.providerSchemas ?? []);
    this.db = createFdevDatabase(this.path, { schema: this.schema });
  }

  async syncSchema(): Promise<SchemaSyncResult> {
    this.schemaSync ??= syncFdevDatabaseSchema(this.db, this.schema);
    return await this.schemaSync;
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.db.select().from(workspaces).orderBy(asc(workspaces.name)).all().map(toWorkspaceRecord);
  }

  findWorkspace(nameOrVmId: string): WorkspaceRecord | undefined {
    const row = this.db
      .select()
      .from(workspaces)
      .where(or(eq(workspaces.name, nameOrVmId), eq(workspaces.vmId, nameOrVmId)))
      .get();
    return row ? toWorkspaceRecord(row) : undefined;
  }

  getWorkspace(name: string): WorkspaceRecord | undefined {
    const row = this.db.select().from(workspaces).where(eq(workspaces.name, name)).get();
    return row ? toWorkspaceRecord(row) : undefined;
  }

  saveWorkspace(workspace: WorkspaceRecord): void {
    this.db
      .insert(workspaces)
      .values(workspace)
      .onConflictDoUpdate({
        target: workspaces.name,
        set: {
          id: workspace.id,
          providerId: workspace.providerId,
          vmId: workspace.vmId,
          machine: workspace.machine,
          snapshotId: workspace.snapshotId,
          updatedAt: workspace.updatedAt,
          metadata: workspace.metadata,
        },
      })
      .run();
  }

  deleteWorkspace(name: string): void {
    this.db.delete(workspaces).where(eq(workspaces.name, name)).run();
  }

  listSnapshots(): SnapshotRecord[] {
    return this.db.select().from(snapshots).orderBy(desc(snapshots.createdAt)).all().map(toSnapshotRecord);
  }

  addSnapshot(snapshot: SnapshotRecord): void {
    this.db.insert(snapshots).values(snapshot).run();
  }

  replaceStepSnapshot(snapshot: SnapshotRecord): void {
    const candidates = this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.machine, snapshot.machine))
      .all()
      .filter((existing) =>
        existing.providerId === snapshot.providerId &&
        existing.machineKey === snapshot.machineKey &&
        existing.prefixLength === snapshot.prefixLength &&
        stableJson(existing.prefixKeys) === stableJson(snapshot.prefixKeys)
      );

    this.db.transaction((tx) => {
      for (const candidate of candidates) {
        tx.delete(snapshots).where(eq(snapshots.id, candidate.id)).run();
      }
      tx.insert(snapshots).values(snapshot).run();
    });
  }
}

function toWorkspaceRecord(row: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    providerId: row.providerId,
    vmId: row.vmId,
    machine: row.machine,
    snapshotId: row.snapshotId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
  };
}

function toSnapshotRecord(row: typeof snapshots.$inferSelect): SnapshotRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    machine: row.machine,
    machineKey: row.machineKey,
    prefixKeys: row.prefixKeys,
    prefixLength: row.prefixLength,
    snapshotId: row.snapshotId,
    sourceVmId: row.sourceVmId,
    createdAt: row.createdAt,
    stepName: row.stepName,
    context: row.context,
    metadata: row.metadata,
  };
}
