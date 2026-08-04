import { randomUUID } from "node:crypto";
import type { CreateProjectRequest, ManagedProject, ProjectSource } from "@stoke/managed";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "./db/client.ts";
import { projects } from "./db/schema.ts";

export async function listProjects(userId: string): Promise<ManagedProject[]> {
  const rows = await getDatabase()
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
  return rows.map(toManagedProject);
}

export async function createProject(userId: string, input: CreateProjectRequest): Promise<ManagedProject> {
  const source = normalizeSource(input.source);
  const sourceKey = keyForSource(source);
  const now = new Date();
  const [row] = await getDatabase()
    .insert(projects)
    .values({
      id: randomUUID(),
      userId,
      slug: input.slug ?? defaultSlug(input.name, source),
      name: input.name,
      source,
      sourceKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projects.userId, projects.sourceKey],
      set: { name: input.name, source, updatedAt: now },
    })
    .returning();

  if (!row) throw new Error("Postgres did not return the created project");
  return toManagedProject(row);
}

export async function findProjectBySource(
  userId: string,
  source: ProjectSource,
): Promise<ManagedProject | undefined> {
  const [row] = await getDatabase()
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.sourceKey, keyForSource(source))))
    .limit(1);
  return row ? toManagedProject(row) : undefined;
}

function normalizeSource(source: ProjectSource): ProjectSource {
  if (source.kind === "github") {
    return {
      kind: "github",
      owner: source.owner.toLowerCase(),
      repository: source.repository.toLowerCase(),
      url: source.url,
    };
  }
  return source;
}

function keyForSource(source: ProjectSource): string {
  return source.kind === "github"
    ? `github:${source.owner}/${source.repository}`
    : `local:${source.machineId}:${source.path}`;
}

function defaultSlug(name: string, source: ProjectSource): string {
  const value = source.kind === "github" ? `${source.owner}-${source.repository}` : name;
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug || `project-${randomUUID().slice(0, 8)}`;
}

function toManagedProject(row: typeof projects.$inferSelect): ManagedProject {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
