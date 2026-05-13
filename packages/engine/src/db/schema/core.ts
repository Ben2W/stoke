import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonValue, WorkspaceResourceRecord } from "../../types.ts";

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    providerId: text("provider_id").notNull(),
    workflow: text("workflow").notNull(),
    resourceId: text("resource_id").notNull(),
    snapshotId: text("snapshot_id"),
    sourceRef: text("source_ref_json", { mode: "json" }).$type<JsonValue>(),
    context: text("context_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
    resources: text("resources_json", { mode: "json" }).$type<Record<string, WorkspaceResourceRecord>>(),
    kv: text("kv_json", { mode: "json" }).$type<Record<string, JsonValue>>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
  },
  (table) => [
    uniqueIndex("workspaces_name_idx").on(table.name),
    index("workspaces_provider_resource_idx").on(table.providerId, table.resourceId),
  ],
);

export const workflowNodeRuns = sqliteTable(
  "workflow_node_runs",
  {
    id: text("id").primaryKey(),
    workflow: text("workflow").notNull(),
    nodePath: text("node_path").notNull(),
    nodeName: text("node_name").notNull(),
    nodeKind: text("node_kind").notNull(),
    nodeKey: text("node_key").notNull(),
    providerFingerprint: text("provider_fingerprint").notNull(),
    upstreamRunIds: text("upstream_run_ids_json", { mode: "json" }).$type<string[]>().notNull(),
    output: text("output_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
    artifacts: text("artifacts_json", { mode: "json" }).$type<JsonValue[]>().notNull(),
    invalidated: integer("invalidated", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
  },
  (table) => [
    index("workflow_node_runs_lookup_idx").on(
      table.workflow,
      table.nodePath,
      table.nodeKey,
      table.providerFingerprint,
    ),
    index("workflow_node_runs_created_idx").on(table.createdAt),
  ],
);

export const providerState = sqliteTable(
  "provider_state",
  {
    providerId: text("provider_id").notNull(),
    key: text("key").notNull(),
    value: text("value_json", { mode: "json" }).$type<JsonValue>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("provider_state_provider_key_idx").on(table.providerId, table.key),
    index("provider_state_provider_idx").on(table.providerId),
  ],
);

export const runtimeMetadata = sqliteTable(
  "runtime_metadata",
  {
    key: text("key").primaryKey(),
    value: text("value_json", { mode: "json" }).$type<JsonValue>().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);
