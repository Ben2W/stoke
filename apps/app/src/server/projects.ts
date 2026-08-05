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
  const source = normalizeProjectSource(input.source);
  const sourceKey = keyForProjectSource(source);
  const existing = await findProjectBySource(userId, source);
  if (existing) return existing;
  const slug = await availableSlug(userId, input.slug ?? defaultProjectSlug(input.name, source));
  const now = new Date();
  const [row] = await getDatabase()
    .insert(projects)
    .values({
      id: randomUUID(),
      userId,
      slug,
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

async function availableSlug(userId: string, desired: string): Promise<string> {
  const rows = await getDatabase()
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.userId, userId));
  const used = new Set(rows.map((row) => row.slug));
  if (!used.has(desired)) return desired;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${desired.slice(0, 63 - String(suffix).length - 1)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `project-${randomUUID().slice(0, 8)}`;
}

export async function findProjectBySource(
  userId: string,
  source: ProjectSource,
): Promise<ManagedProject | undefined> {
  const [row] = await getDatabase()
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.sourceKey, keyForProjectSource(source))))
    .limit(1);
  return row ? toManagedProject(row) : undefined;
}

export function normalizeProjectSource(source: ProjectSource): ProjectSource {
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

export function keyForProjectSource(source: ProjectSource): string {
  return source.kind === "github"
    ? `github:${source.owner}/${source.repository}`
    : `local:${source.machineId}:${source.path}`;
}

export function defaultProjectSlug(name: string, source: ProjectSource): string {
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
