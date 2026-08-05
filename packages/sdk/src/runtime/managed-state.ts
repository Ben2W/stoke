import { readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  createManagedClient,
  ManagedProjectStateSnapshotSchema,
  type ManagedProjectStateSnapshot,
} from "@stoke/managed";
import {
  createRuntimeStateCoordinator,
  emptyRuntimeStateSnapshot,
  type RuntimeStateCoordinator,
  type RuntimeStateSnapshot,
} from "./state.ts";

export async function loadRuntimeState(options: {
  managedProjectId?: string;
  managedApiUrl?: string;
  managedToken?: string;
  stateFile?: string;
}): Promise<RuntimeStateCoordinator> {
  if (options.stateFile) return loadFileState(options.stateFile);
  if (options.managedProjectId && options.managedApiUrl && options.managedToken) {
    return await loadManagedState(options.managedProjectId, options.managedApiUrl, options.managedToken);
  }
  return createRuntimeStateCoordinator();
}

function loadFileState(path: string): RuntimeStateCoordinator {
  const stored = readStoredState(path);
  return createRuntimeStateCoordinator({
    snapshot: stored.snapshot,
    async persist(snapshot) {
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ revision: stored.revision, snapshot })}\n`);
      renameSync(temporary, path);
    },
  });
}

async function loadManagedState(
  projectId: string,
  apiUrl: string,
  token: string,
): Promise<RuntimeStateCoordinator> {
  const client = createManagedClient({ baseUrl: apiUrl, token });
  let stored = await client.getProjectState(projectId);
  return createRuntimeStateCoordinator({
    snapshot: asRuntimeSnapshot(stored.snapshot),
    async persist(snapshot) {
      stored = await client.updateProjectState(
        projectId,
        stored.revision,
        snapshot as ManagedProjectStateSnapshot,
      );
    },
  });
}

function readStoredState(path: string): { revision: number; snapshot: RuntimeStateSnapshot } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      revision?: unknown;
      snapshot?: unknown;
    };
    return {
      revision: typeof value.revision === "number" ? value.revision : 0,
      snapshot: asRuntimeSnapshot(value.snapshot),
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return { revision: 0, snapshot: emptyRuntimeStateSnapshot() };
    }
    throw new Error(`Could not read Stoke workflow state from ${path}`, { cause: error });
  }
}

function asRuntimeSnapshot(value: unknown): RuntimeStateSnapshot {
  return ManagedProjectStateSnapshotSchema.parse(value) as RuntimeStateSnapshot;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
