import { randomUUID } from "node:crypto";
import type { CreateProjectRequest, ManagedProject, ProjectSource } from "@stoke/managed";
import { requirePublicGitHubRepository } from "./github-repository.ts";
import { projectRepository, type ProjectRow } from "./repositories/project-repository.ts";

export async function listProjects(userId: string): Promise<ManagedProject[]> {
  const rows = await projectRepository.listForUser(userId);
  return rows.map(toManagedProject);
}

export async function createProject(userId: string, input: CreateProjectRequest): Promise<ManagedProject> {
  const source = normalizeProjectSource(input.source);
  if (source.kind === "github") await requirePublicGitHubRepository(source);
  const sourceKey = keyForProjectSource(source);
  if (!input.forceNew) {
    const existing = await findProjectBySource(userId, source);
    if (existing) return existing;
  }
  const slug = await availableSlug(userId, input.slug ?? defaultProjectSlug(input.name, source));
  const now = new Date();
  const row = await projectRepository.create({
    id: randomUUID(),
    userId,
    slug,
    name: input.name,
    source,
    sourceKey,
    now,
  });
  return toManagedProject(row);
}

export async function deleteProject(userId: string, projectId: string): Promise<ManagedProject | undefined> {
  const row = await projectRepository.deleteOwnedById(userId, projectId);
  return row ? toManagedProject(row) : undefined;
}

export async function verifyProjectSource(
  userId: string,
  projectId: string,
): Promise<ManagedProject | undefined> {
  const project = await getProject(userId, projectId);
  if (project?.source.kind === "github") await requirePublicGitHubRepository(project.source);
  return project;
}

export async function getProject(userId: string, projectId: string): Promise<ManagedProject | undefined> {
  const row = await projectRepository.findOwnedById(userId, projectId);
  return row ? toManagedProject(row) : undefined;
}

async function availableSlug(userId: string, desired: string): Promise<string> {
  const used = new Set(await projectRepository.listSlugs(userId));
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
  const row = await projectRepository.findBySourceKey(userId, keyForProjectSource(source));
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

function toManagedProject(row: ProjectRow): ManagedProject {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
