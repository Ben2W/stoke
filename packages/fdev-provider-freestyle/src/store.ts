import { eq } from "drizzle-orm";
import type { FdevDatabase } from "@freestyle-sh/fdev-engine";
import type { JsonValue } from "@freestyle-sh/fdev-sdk";
import { freestyleGitRelationships } from "./schema.ts";

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

export function createFreestyleStore(db: FdevDatabase) {
  return {
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
