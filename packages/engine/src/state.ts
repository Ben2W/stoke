import { join } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ProviderStorage, ProviderStorageRecord } from "./provider/types.ts";
import type { JsonValue, WorkspaceRecord } from "./types.ts";
import {
  createRigkitDatabase,
  syncRigkitDatabaseSchema,
  type RigkitDatabase,
  type SchemaSyncResult,
} from "./db/index.ts";
import { coreSchema, type CoreSchema } from "./db/schema/index.ts";
import { providerState, runtimeMetadata, workflowNodeRuns, workspaces } from "./db/schema/index.ts";
import { stableJson } from "./hash.ts";
import { RIGKIT_ENGINE_VERSION } from "./version.ts";

export type WorkflowNodeRunRecord = {
  id: string;
  workflow: string;
  nodePath: string;
  nodeName: string;
  nodeKind: string;
  nodeKey: string;
  providerFingerprint: string;
  upstreamRunIds: string[];
  output: Record<string, JsonValue>;
  artifacts: JsonValue[];
  invalidated: boolean;
  createdAt: string;
  metadata: Record<string, JsonValue>;
};

export type SnapshotRecord = WorkflowNodeRunRecord;

export type StateServiceOptions = {
  projectDir: string;
  statePath?: string;
  projectId?: string;
  configPath?: string;
  runtimeVersion?: string;
  source?: JsonValue;
};

export type StateServiceFactory = (options: StateServiceOptions) => StateService;

export interface StateService {
  readonly path: string;
  syncSchema(): Promise<SchemaSyncResult>;
  listWorkspaces(): WorkspaceRecord[];
  findWorkspace(nameOrResourceId: string): WorkspaceRecord | undefined;
  getWorkspace(name: string): WorkspaceRecord | undefined;
  saveWorkspace(workspace: WorkspaceRecord): void;
  deleteWorkspace(name: string): void;
  listNodeRuns(): WorkflowNodeRunRecord[];
  listSnapshots(): SnapshotRecord[];
  findReusableNodeRun(input: {
    workflow: string;
    nodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
  }): WorkflowNodeRunRecord | undefined;
  saveNodeRun(run: WorkflowNodeRunRecord): void;
  providerStorage(providerId: string): ProviderStorage;
}

export class StateStore implements StateService {
  readonly path: string;
  readonly db: RigkitDatabase<CoreSchema>;
  private readonly schema = coreSchema;
  private readonly projectDir: string;
  private readonly metadata: Omit<StateServiceOptions, "projectDir" | "statePath">;
  private schemaSync?: Promise<SchemaSyncResult>;

  constructor(projectDir: string, options: Omit<StateServiceOptions, "projectDir"> = {}) {
    this.projectDir = projectDir;
    this.path = options.statePath ?? join(projectDir, ".rigkit", "state.sqlite");
    this.metadata = {
      projectId: options.projectId,
      configPath: options.configPath,
      runtimeVersion: options.runtimeVersion,
      source: options.source,
    };
    this.db = createRigkitDatabase(this.path, { schema: this.schema });
  }

  async syncSchema(): Promise<SchemaSyncResult> {
    this.schemaSync ??= this.syncSchemaOnce();
    return await this.schemaSync;
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.db.select().from(workspaces).orderBy(asc(workspaces.name)).all().map(toWorkspaceRecord);
  }

  findWorkspace(nameOrResourceId: string): WorkspaceRecord | undefined {
    const row = this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.name, nameOrResourceId))
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
          workflow: workspace.workflow,
          workflowCtx: workspace.workflowCtx,
          updatedAt: workspace.updatedAt,
          ctx: workspace.ctx,
        },
      })
      .run();
  }

  deleteWorkspace(name: string): void {
    this.db.delete(workspaces).where(eq(workspaces.name, name)).run();
  }

  listNodeRuns(): WorkflowNodeRunRecord[] {
    return this.db
      .select()
      .from(workflowNodeRuns)
      .orderBy(desc(workflowNodeRuns.createdAt))
      .all()
      .map(toNodeRunRecord);
  }

  listSnapshots(): SnapshotRecord[] {
    return this.listNodeRuns();
  }

  findReusableNodeRun(input: {
    workflow: string;
    nodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
  }): WorkflowNodeRunRecord | undefined {
    const upstream = stableJson([...input.upstreamRunIds]);
    const candidates = this.db
      .select()
      .from(workflowNodeRuns)
      .where(eq(workflowNodeRuns.workflow, input.workflow))
      .orderBy(desc(workflowNodeRuns.createdAt))
      .all()
      .filter((run) =>
        !run.invalidated &&
        run.nodePath === input.nodePath &&
        run.nodeKey === input.nodeKey &&
        run.providerFingerprint === input.providerFingerprint &&
        stableJson(run.upstreamRunIds) === upstream
      );

    const row = candidates[0];
    return row ? toNodeRunRecord(row) : undefined;
  }

  saveNodeRun(run: WorkflowNodeRunRecord): void {
    this.db.insert(workflowNodeRuns).values(run).run();
  }

  providerStorage(providerId: string): ProviderStorage {
    return new StateProviderStorage(this.db, providerId);
  }

  private async syncSchemaOnce(): Promise<SchemaSyncResult> {
    const result = await syncRigkitDatabaseSchema(this.db, this.schema);
    this.writeRuntimeMetadata(result.schemaVersion);
    return result;
  }

  private writeRuntimeMetadata(schemaVersion: string): void {
    const now = new Date().toISOString();
    const entries: Array<[string, JsonValue]> = [
      ["engine.version", RIGKIT_ENGINE_VERSION],
      ["state.schemaVersion", schemaVersion],
      ["project.dir", this.projectDir],
      ["state.path", this.path],
    ];

    if (this.metadata.projectId) entries.push(["project.id", this.metadata.projectId]);
    if (this.metadata.configPath) entries.push(["config.path", this.metadata.configPath]);
    if (this.metadata.runtimeVersion) entries.push(["runtime.version", this.metadata.runtimeVersion]);
    if (this.metadata.source !== undefined) entries.push(["source", this.metadata.source]);

    for (const [key, value] of entries) {
      this.db
        .insert(runtimeMetadata)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: runtimeMetadata.key,
          set: { value, updatedAt: now },
        })
        .run();
    }
  }
}

export const createStateStore: StateServiceFactory = (options) =>
  new StateStore(options.projectDir, options);

function toWorkspaceRecord(row: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    workflow: row.workflow,
    workflowCtx: row.workflowCtx,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ctx: row.ctx,
  };
}

function toNodeRunRecord(row: typeof workflowNodeRuns.$inferSelect): WorkflowNodeRunRecord {
  return {
    id: row.id,
    workflow: row.workflow,
    nodePath: row.nodePath,
    nodeName: row.nodeName,
    nodeKind: row.nodeKind,
    nodeKey: row.nodeKey,
    providerFingerprint: row.providerFingerprint,
    upstreamRunIds: row.upstreamRunIds,
    output: row.output,
    artifacts: row.artifacts,
    invalidated: row.invalidated,
    createdAt: row.createdAt,
    metadata: row.metadata,
  };
}

class StateProviderStorage implements ProviderStorage {
  constructor(
    private readonly db: RigkitDatabase<CoreSchema>,
    private readonly providerId: string,
  ) {}

  get<Value extends JsonValue = JsonValue>(key: string): ProviderStorageRecord<Value> | undefined {
    const row = this.db
      .select()
      .from(providerState)
      .where(and(eq(providerState.providerId, this.providerId), eq(providerState.key, key)))
      .get();
    return row ? toProviderStorageRecord(row) as ProviderStorageRecord<Value> : undefined;
  }

  set<Value extends JsonValue = JsonValue>(key: string, value: Value): ProviderStorageRecord<Value> {
    const now = new Date().toISOString();
    const existing = this.get(key);
    const record: ProviderStorageRecord<Value> = {
      providerId: this.providerId,
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .insert(providerState)
      .values(record)
      .onConflictDoUpdate({
        target: [providerState.providerId, providerState.key],
        set: {
          value,
          updatedAt: record.updatedAt,
        },
      })
      .run();
    return record;
  }

  delete(key: string): void {
    this.db
      .delete(providerState)
      .where(and(eq(providerState.providerId, this.providerId), eq(providerState.key, key)))
      .run();
  }

  entries(prefix = ""): ProviderStorageRecord[] {
    const rows = this.db
      .select()
      .from(providerState)
      .where(eq(providerState.providerId, this.providerId))
      .orderBy(asc(providerState.key))
      .all();
    return rows
      .filter((row) => row.key.startsWith(prefix))
      .map(toProviderStorageRecord);
  }
}

function toProviderStorageRecord(row: typeof providerState.$inferSelect): ProviderStorageRecord {
  return {
    providerId: row.providerId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
