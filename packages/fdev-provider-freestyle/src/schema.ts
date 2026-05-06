import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonValue } from "@freestyle-sh/fdev-sdk";

export const freestyleGitRelationships = sqliteTable(
  "freestyle_git_relationships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    vmId: text("vm_id").notNull(),
    remoteUrl: text("remote_url"),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, JsonValue>>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("freestyle_git_relationships_workspace_idx").on(table.workspaceId),
    index("freestyle_git_relationships_vm_idx").on(table.vmId),
  ],
);

export const freestyleIdentities = sqliteTable(
  "freestyle_identities",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    identityId: text("identity_id").notNull(),
    tokenId: text("token_id").notNull(),
    token: text("token").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("freestyle_identities_key_idx").on(table.key),
    uniqueIndex("freestyle_identities_identity_idx").on(table.identityId),
  ],
);

export const freestyleSchema = {
  freestyleGitRelationships,
  freestyleIdentities,
};

export type FreestyleSchema = typeof freestyleSchema;
