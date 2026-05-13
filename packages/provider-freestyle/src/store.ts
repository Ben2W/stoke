import type { ProviderStorage } from "@rigkit/engine";
import type { JsonValue } from "@rigkit/sdk";
import {
  freestyleIdentityId,
  freestyleToken,
  freestyleTokenId,
  type FreestyleIdentityId,
  type FreestyleToken,
  type FreestyleTokenId,
} from "./auth.ts";

const DEFAULT_IDENTITY_KEY = "default";

export type FreestyleGitRelationship = {
  id: string;
  workspaceId: string;
  vmId: string;
  remoteUrl?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
};

export type FreestyleIdentity = {
  id: string;
  key: string;
  identityId: FreestyleIdentityId;
  tokenId: FreestyleTokenId;
  token: FreestyleToken;
  createdAt: string;
  updatedAt: string;
};

export function createFreestyleStore(storage: ProviderStorage) {
  return {
    getIdentity(key = DEFAULT_IDENTITY_KEY): FreestyleIdentity | undefined {
      return parseIdentity(storage.get(identityKey(key))?.value);
    },

    saveIdentity(input: {
      key?: string;
      identityId: FreestyleIdentityId;
      tokenId: FreestyleTokenId;
      token: FreestyleToken;
    }): FreestyleIdentity {
      const now = new Date().toISOString();
      const key = input.key ?? DEFAULT_IDENTITY_KEY;
      const existing = this.getIdentity(key);
      const identity: FreestyleIdentity = {
        id: existing?.id ?? crypto.randomUUID(),
        key,
        identityId: input.identityId,
        tokenId: input.tokenId,
        token: input.token,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      storage.set(identityKey(key), identity as unknown as JsonValue);
      return identity;
    },

    getGitRelationship(workspaceId: string): FreestyleGitRelationship | undefined {
      return parseGitRelationship(storage.get(gitRelationshipKey(workspaceId))?.value);
    },

    saveGitRelationship(input: Omit<FreestyleGitRelationship, "id" | "createdAt" | "updatedAt">): FreestyleGitRelationship {
      const now = new Date().toISOString();
      const existing = this.getGitRelationship(input.workspaceId);
      const relationship: FreestyleGitRelationship = {
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...input,
      };

      storage.set(gitRelationshipKey(input.workspaceId), relationship as unknown as JsonValue);
      return relationship;
    },
  };
}

function identityKey(key: string): string {
  return `identity:${key}`;
}

function gitRelationshipKey(workspaceId: string): string {
  return `git:${workspaceId}`;
}

function parseIdentity(value: JsonValue | undefined): FreestyleIdentity | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: requiredString(value, "id"),
    key: requiredString(value, "key"),
    identityId: freestyleIdentityId(requiredString(value, "identityId")),
    tokenId: freestyleTokenId(requiredString(value, "tokenId")),
    token: freestyleToken(requiredString(value, "token")),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
  };
}

function parseGitRelationship(value: JsonValue | undefined): FreestyleGitRelationship | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: requiredString(value, "id"),
    workspaceId: requiredString(value, "workspaceId"),
    vmId: requiredString(value, "vmId"),
    remoteUrl: optionalStringOrNull(value, "remoteUrl"),
    branch: optionalStringOrNull(value, "branch"),
    commitSha: optionalStringOrNull(value, "commitSha"),
    metadata: recordValue(value.metadata),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
  };
}

function requiredString(record: Record<string, JsonValue>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid Freestyle provider state: ${key} must be a non-empty string`);
  }
  return value;
}

function optionalStringOrNull(record: Record<string, JsonValue>, key: string): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value === "string") return value;
  throw new Error(`Invalid Freestyle provider state: ${key} must be a string or null`);
}

function recordValue(value: JsonValue | undefined): Record<string, JsonValue> {
  if (isRecord(value)) return value;
  throw new Error(`Invalid Freestyle provider state: metadata must be an object`);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
