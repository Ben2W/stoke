import { and, eq } from "drizzle-orm";
import type { ManagedProjectStateSnapshot } from "@usestoke/managed";
import { getDatabase } from "../db/client.ts";
import { projectStates } from "../db/schema.ts";

export const projectStateRepository = {
  async find(userId: string, projectId: string) {
    const [row] = await getDatabase()
      .select()
      .from(projectStates)
      .where(and(eq(projectStates.userId, userId), eq(projectStates.projectId, projectId)))
      .limit(1);
    return row;
  },

  async update(
    userId: string,
    projectId: string,
    expectedRevision: number,
    snapshot: ManagedProjectStateSnapshot,
  ) {
    const revision = expectedRevision + 1;
    const now = new Date();
    if (expectedRevision === 0) {
      const [created] = await getDatabase()
        .insert(projectStates)
        .values({ userId, projectId, revision, snapshot, updatedAt: now })
        .onConflictDoNothing()
        .returning();
      return created;
    }
    const [updated] = await getDatabase()
      .update(projectStates)
      .set({ revision, snapshot, updatedAt: now })
      .where(and(
        eq(projectStates.userId, userId),
        eq(projectStates.projectId, projectId),
        eq(projectStates.revision, expectedRevision),
      ))
      .returning();
    return updated;
  },
};
