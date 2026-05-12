import type { ProviderStorage } from "@freestyle-sh/fdev-engine";
import type { JsonValue } from "@freestyle-sh/fdev";

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

export function createGcloudAuthStore(storage: ProviderStorage) {
  return {
    getCredentials(key = DEFAULT_GCLOUD_CREDENTIAL_KEY): GcloudStoredCredentials | undefined {
      return parseCredentials(storage.get(credentialsKey(key))?.value);
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

      storage.set(credentialsKey(key), credentials as unknown as JsonValue);
      return credentials;
    },
  };
}

export function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function credentialsKey(key: string): string {
  return `credentials:${key}`;
}

function parseCredentials(value: JsonValue | undefined): GcloudStoredCredentials | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: requiredString(value, "id"),
    key: requiredString(value, "key"),
    account: optionalStringOrNull(value, "account"),
    scopes: stringArray(value.scopes, "scopes"),
    accessToken: requiredString(value, "accessToken"),
    tokenType: requiredString(value, "tokenType"),
    expiresAt: requiredString(value, "expiresAt"),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
  };
}

function requiredString(record: Record<string, JsonValue>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid gcloud provider state: ${key} must be a non-empty string`);
  }
  return value;
}

function optionalStringOrNull(record: Record<string, JsonValue>, key: string): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value === "string") return value;
  throw new Error(`Invalid gcloud provider state: ${key} must be a string or null`);
}

function stringArray(value: JsonValue | undefined, key: string): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error(`Invalid gcloud provider state: ${key} must be a string array`);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
