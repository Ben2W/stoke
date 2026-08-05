import type {
  ManagedProjectStateSnapshot,
  ProjectStateResponse,
  UpdateProjectStateRequest,
} from "@stoke/managed";
import { getProject } from "./projects.ts";
import { projectStateRepository } from "./repositories/project-state-repository.ts";

export async function getProjectState(userId: string, projectId: string): Promise<ProjectStateResponse> {
  await requireProject(userId, projectId);
  const row = await projectStateRepository.find(userId, projectId);
  return row
    ? { revision: row.revision, snapshot: row.snapshot }
    : { revision: 0, snapshot: emptyManagedProjectState() };
}

export async function updateProjectState(
  userId: string,
  projectId: string,
  input: UpdateProjectStateRequest,
): Promise<ProjectStateResponse> {
  await requireProject(userId, projectId);
  const row = await projectStateRepository.update(
    userId,
    projectId,
    input.expectedRevision,
    input.snapshot,
  );
  if (!row) {
    const current = await projectStateRepository.find(userId, projectId);
    throw new ProjectStateConflictError(current?.revision ?? 0);
  }
  return { revision: row.revision, snapshot: row.snapshot };
}

export class ProjectStateConflictError extends Error {
  override name = "ProjectStateConflictError";

  constructor(readonly currentRevision: number) {
    super(`Project state changed concurrently; current revision is ${currentRevision}`);
  }
}

function emptyManagedProjectState(): ManagedProjectStateSnapshot {
  return { version: 1, scopes: {} };
}

async function requireProject(userId: string, projectId: string): Promise<void> {
  if (!await getProject(userId, projectId)) throw new Error("Managed project was not found");
}
