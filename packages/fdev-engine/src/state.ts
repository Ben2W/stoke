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
import { workflowNodeRuns, workspaces } from "./db/schema/index.ts";
import { stableJson } from "./hash.ts";

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

  findWorkspace(nameOrResourceId: string): WorkspaceRecord | undefined {
    const row = this.db
      .select()
      .from(workspaces)
      .where(or(eq(workspaces.name, nameOrResourceId), eq(workspaces.resourceId, nameOrResourceId)))
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
          workflow: workspace.workflow,
          resourceId: workspace.resourceId,
          snapshotId: workspace.snapshotId,
          sourceRef: workspace.sourceRef,
          context: workspace.context,
          updatedAt: workspace.updatedAt,
          metadata: workspace.metadata,
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
}

function toWorkspaceRecord(row: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    providerId: row.providerId,
    workflow: row.workflow,
    resourceId: row.resourceId,
    snapshotId: row.snapshotId ?? undefined,
    sourceRef: row.sourceRef,
    context: row.context,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
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
