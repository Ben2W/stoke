import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const gcloudLocalCredentials = sqliteTable(
  "gcloud_local_credentials",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    account: text("account"),
    scopes: text("scopes_json", { mode: "json" }).$type<string[]>().notNull(),
    accessToken: text("access_token").notNull(),
    tokenType: text("token_type").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("gcloud_local_credentials_key_idx").on(table.key),
    index("gcloud_local_credentials_account_idx").on(table.account),
  ],
);

export const gcloudAuthSchema = {
  gcloudLocalCredentials,
};

export type GcloudAuthSchema = typeof gcloudAuthSchema;
