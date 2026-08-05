import { createHash } from "node:crypto";
import type {
  InvalidateProjectCacheRequest,
  ManagedCacheEntry,
  ManagedProjectStateSnapshot,
  ProjectCacheMutationResponse,
  ProjectCacheResponse,
} from "@stoke/managed";
import {
  getProjectState,
  ProjectStateConflictError,
  updateProjectState,
} from "./project-state.ts";

const MAX_UPDATE_ATTEMPTS = 3;

export async function listProjectCache(
  userId: string,
  projectId: string,
): Promise<ProjectCacheResponse> {
  const state = await getProjectState(userId, projectId);
  return {
    revision: state.revision,
    entries: projectCacheEntries(state.snapshot),
  };
}

export async function invalidateProjectCache(
  userId: string,
  projectId: string,
  input: InvalidateProjectCacheRequest,
): Promise<ProjectCacheMutationResponse> {
  return await mutateProjectCache(userId, projectId, (snapshot) => invalidateCacheSnapshot(snapshot, input));
}

export async function clearProjectCache(
  userId: string,
  projectId: string,
): Promise<ProjectCacheMutationResponse> {
  return await mutateProjectCache(userId, projectId, clearCacheSnapshot);
}

export function projectCacheEntries(snapshot: ManagedProjectStateSnapshot): ManagedCacheEntry[] {
  const entries = Object.entries(snapshot.scopes).flatMap(([scope, state]) =>
    state.nodeRuns.flatMap((value) => {
      const entry = parseCacheEntry(value);
      return entry ? [{ scope, ...entry }] : [];
    })
  ).filter((entry) => !entry.invalidated)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  // nodeRuns is an append-only cache history. The dashboard graph represents
  // the reusable DAG, not that history, so keep only the newest live result for
  // each logical workflow node.
  const current = new Map<string, ManagedCacheEntry>();
  for (const entry of entries) {
    const key = `${entry.scope}\0${entry.workflow}\0${entry.nodePath}`;
    if (!current.has(key)) current.set(key, entry);
  }
  return [...current.values()];
}

export function invalidateCacheSnapshot(
  snapshot: ManagedProjectStateSnapshot,
  input: InvalidateProjectCacheRequest,
): number {
  const scope = snapshot.scopes[input.scope];
  if (!scope) throw new Error("Cache entry was not found");
  const target = scope.nodeRuns.map(parseNodeRun).find((run) => run?.id === input.entryId);
  if (!target) throw new Error("Cache entry was not found");

  const runs = Object.values(snapshot.scopes).flatMap((state) => state.nodeRuns.map(parseNodeRun));

  const affectedIds = new Set([target.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of runs) {
      if (!run || affectedIds.has(run.id)) continue;
      if (run.upstreamRunIds.some((id) => affectedIds.has(id))) {
        affectedIds.add(run.id);
        changed = true;
      }
    }
  }

  let affected = 0;
  for (const state of Object.values(snapshot.scopes)) {
    state.nodeRuns = state.nodeRuns.map((value) => {
      const run = parseNodeRun(value);
      if (!run || !affectedIds.has(run.id) || run.invalidated) return value;
      affected += 1;
      return { ...run, invalidated: true };
    });
  }
  return affected;
}

export function clearCacheSnapshot(snapshot: ManagedProjectStateSnapshot): number {
  let affected = 0;
  for (const scope of Object.values(snapshot.scopes)) {
    affected += scope.nodeRuns.length;
    scope.nodeRuns = [];
  }
  return affected;
}

async function mutateProjectCache(
  userId: string,
  projectId: string,
  mutate: (snapshot: ManagedProjectStateSnapshot) => number,
): Promise<ProjectCacheMutationResponse> {
  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const state = await getProjectState(userId, projectId);
    const snapshot = structuredClone(state.snapshot);
    const affected = mutate(snapshot);
    if (affected === 0) return { revision: state.revision, affected: 0 };
    try {
      const updated = await updateProjectState(userId, projectId, {
        expectedRevision: state.revision,
        snapshot,
      });
      return { revision: updated.revision, affected };
    } catch (error) {
      if (!(error instanceof ProjectStateConflictError) || attempt === MAX_UPDATE_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error("Could not update project cache");
}

function parseCacheEntry(value: unknown): {
  id: string;
  workflow: string;
  nodePath: string;
  nodeName: string;
  nodeKind: string;
  fingerprint: string;
  upstreamRunIds: string[];
  invalidated: boolean;
  createdAt: string;
} | undefined {
  const run = parseNodeRun(value);
  if (!run || typeof run.workflow !== "string" || typeof run.nodePath !== "string"
    || typeof run.nodeName !== "string" || typeof run.nodeKind !== "string"
    || typeof run.nodeKey !== "string" || typeof run.providerFingerprint !== "string"
    || typeof run.createdAt !== "string" || Number.isNaN(Date.parse(run.createdAt))) return undefined;
  return {
    id: run.id,
    workflow: run.workflow,
    nodePath: run.nodePath,
    nodeName: run.nodeName,
    nodeKind: run.nodeKind,
    fingerprint: `cache:${createHash("sha256").update(JSON.stringify({
      nodeKey: run.nodeKey,
      providerFingerprint: run.providerFingerprint,
      upstreamRunIds: run.upstreamRunIds,
    })).digest("hex")}`,
    upstreamRunIds: run.upstreamRunIds,
    invalidated: run.invalidated,
    createdAt: run.createdAt,
  };
}

function parseNodeRun(value: unknown): (Record<string, unknown> & {
  id: string;
  upstreamRunIds: string[];
  invalidated: boolean;
}) | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id
    || !Array.isArray(value.upstreamRunIds) || !value.upstreamRunIds.every((id) => typeof id === "string")
    || typeof value.invalidated !== "boolean") return undefined;
  return {
    ...value,
    id: value.id,
    upstreamRunIds: value.upstreamRunIds,
    invalidated: value.invalidated,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
