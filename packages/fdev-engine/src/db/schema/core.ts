import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonValue } from "@freestyle-sh/fdev-sdk";

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    providerId: text("provider_id").notNull(),
    vmId: text("vm_id").notNull(),
    machine: text("machine").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
  },
  (table) => [
    uniqueIndex("workspaces_name_idx").on(table.name),
    index("workspaces_provider_vm_idx").on(table.providerId, table.vmId),
  ],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    machine: text("machine").notNull(),
    machineKey: text("machine_key").notNull(),
    prefixKeys: text("prefix_keys_json", { mode: "json" }).$type<string[]>().notNull(),
    prefixLength: integer("prefix_length").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    sourceVmId: text("source_vm_id").notNull(),
    createdAt: text("created_at").notNull(),
    stepName: text("step_name").notNull(),
    context: text("context_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
  },
  (table) => [
    index("snapshots_machine_key_idx").on(table.machine, table.machineKey),
    index("snapshots_provider_snapshot_idx").on(table.providerId, table.snapshotId),
  ],
);
