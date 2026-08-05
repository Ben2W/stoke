import type { ProjectSource } from "@usestoke/managed";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "../db/client.ts";
import { projects } from "../db/schema.ts";

export type ProjectRow = typeof projects.$inferSelect;

export const projectRepository = {
  async listForUser(userId: string): Promise<ProjectRow[]> {
    return await getDatabase()
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));
  },

  async findOwnedById(userId: string, projectId: string): Promise<ProjectRow | undefined> {
    const [row] = await getDatabase()
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    return row;
  },

  async findBySourceKey(userId: string, sourceKey: string): Promise<ProjectRow | undefined> {
    const [row] = await getDatabase()
      .select()
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.sourceKey, sourceKey)))
      .orderBy(desc(projects.updatedAt))
      .limit(1);
    return row;
  },

  async deleteOwnedById(userId: string, projectId: string): Promise<ProjectRow | undefined> {
    const [row] = await getDatabase()
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();
    return row;
  },

  async listSlugs(userId: string): Promise<string[]> {
    const rows = await getDatabase()
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.userId, userId));
    return rows.map((row) => row.slug);
  },

  async create(input: {
    id: string;
    userId: string;
    slug: string;
    name: string;
    source: ProjectSource;
    sourceKey: string;
    now: Date;
  }): Promise<ProjectRow> {
    const [row] = await getDatabase()
      .insert(projects)
      .values({
        ...input,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    if (!row) throw new Error("Postgres did not return the created project");
    return row;
  },
};
