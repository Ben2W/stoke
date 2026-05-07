import { eq } from "drizzle-orm";
import type { FdevDatabase, FdevDatabaseSchema } from "@freestyle-sh/fdev-engine";
import { gcloudLocalCredentials } from "./schema.ts";

export const DEFAULT_GCLOUD_CREDENTIAL_KEY = "default";

export type GcloudStoredCredentials = {
  id: string;
  key: string;
  account?: string | null;
  scopes: string[];
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type GcloudCredentialsInput = {
  key?: string;
  account?: string | null;
  scopes: string[];
  accessToken: string;
  tokenType?: string;
  expiresAt: string;
};

export function createGcloudAuthStore<TSchema extends FdevDatabaseSchema>(db: FdevDatabase<TSchema>) {
  return {
    getCredentials(key = DEFAULT_GCLOUD_CREDENTIAL_KEY): GcloudStoredCredentials | undefined {
      const row = db
        .select()
        .from(gcloudLocalCredentials)
        .where(eq(gcloudLocalCredentials.key, key))
        .get();
      return row ? toCredentials(row) : undefined;
    },

    saveCredentials(input: GcloudCredentialsInput): GcloudStoredCredentials {
      const now = new Date().toISOString();
      const key = input.key ?? DEFAULT_GCLOUD_CREDENTIAL_KEY;
      const existing = this.getCredentials(key);
      const credentials: GcloudStoredCredentials = {
        id: existing?.id ?? crypto.randomUUID(),
        key,
        account: input.account ?? existing?.account ?? null,
        scopes: normalizeScopes(input.scopes),
        accessToken: input.accessToken,
        tokenType: input.tokenType ?? "Bearer",
        expiresAt: input.expiresAt,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      db.insert(gcloudLocalCredentials)
        .values(credentials)
        .onConflictDoUpdate({
          target: gcloudLocalCredentials.key,
          set: {
            account: credentials.account,
            scopes: credentials.scopes,
            accessToken: credentials.accessToken,
            tokenType: credentials.tokenType,
            expiresAt: credentials.expiresAt,
            updatedAt: credentials.updatedAt,
          },
        })
        .run();

      return credentials;
    },
  };
}

export function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function toCredentials(row: typeof gcloudLocalCredentials.$inferSelect): GcloudStoredCredentials {
  return {
    id: row.id,
    key: row.key,
    account: row.account,
    scopes: row.scopes,
    accessToken: row.accessToken,
    tokenType: row.tokenType,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
