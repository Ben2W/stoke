import { eq } from "drizzle-orm";
import type { FdevDatabase, FdevDatabaseSchema } from "@freestyle-sh/fdev-engine";
import type { JsonValue } from "@freestyle-sh/fdev-sdk";
import {
  freestyleIdentityId,
  freestyleToken,
  freestyleTokenId,
  type FreestyleIdentityId,
  type FreestyleToken,
  type FreestyleTokenId,
} from "./auth.ts";
import { freestyleGitRelationships, freestyleIdentities } from "./schema.ts";

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

export function createFreestyleStore<TSchema extends FdevDatabaseSchema>(db: FdevDatabase<TSchema>) {
  return {
    getIdentity(key = DEFAULT_IDENTITY_KEY): FreestyleIdentity | undefined {
      const row = db
        .select()
        .from(freestyleIdentities)
        .where(eq(freestyleIdentities.key, key))
        .get();
      return row ? toIdentity(row) : undefined;
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

      db.insert(freestyleIdentities)
        .values(identity)
        .onConflictDoUpdate({
          target: freestyleIdentities.key,
          set: {
            identityId: identity.identityId,
            tokenId: identity.tokenId,
            token: identity.token,
            updatedAt: identity.updatedAt,
          },
        })
        .run();

      return identity;
    },

    getGitRelationship(workspaceId: string): FreestyleGitRelationship | undefined {
      const row = db
        .select()
        .from(freestyleGitRelationships)
        .where(eq(freestyleGitRelationships.workspaceId, workspaceId))
        .get();
      return row ? toGitRelationship(row) : undefined;
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

      db.insert(freestyleGitRelationships)
        .values(relationship)
        .onConflictDoUpdate({
          target: freestyleGitRelationships.workspaceId,
          set: {
            vmId: relationship.vmId,
            remoteUrl: relationship.remoteUrl,
            branch: relationship.branch,
            commitSha: relationship.commitSha,
            metadata: relationship.metadata,
            updatedAt: relationship.updatedAt,
          },
        })
        .run();

      return relationship;
    },
  };
}

function toIdentity(row: typeof freestyleIdentities.$inferSelect): FreestyleIdentity {
  return {
    id: row.id,
    key: row.key,
    identityId: freestyleIdentityId(row.identityId),
    tokenId: freestyleTokenId(row.tokenId),
    token: freestyleToken(row.token),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toGitRelationship(row: typeof freestyleGitRelationships.$inferSelect): FreestyleGitRelationship {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    vmId: row.vmId,
    remoteUrl: row.remoteUrl,
    branch: row.branch,
    commitSha: row.commitSha,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
