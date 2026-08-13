import type { ManagedCacheEntry, ManagedRun } from "@usestoke/managed";
import type { RunTask, RunTaskFlow, RunTaskStatus } from "../runs/_components/run-task-flow.ts";

export type CacheGraphNodeActivity = {
  status: RunTaskStatus;
  synthetic: boolean;
};

export type CacheGraphModel = {
  activities: Map<string, CacheGraphNodeActivity>;
  entries: ManagedCacheEntry[];
  mainEntryIds: Set<string>;
};

export function projectCacheGraph(
  entries: ManagedCacheEntry[],
  planned?: { flow: RunTaskFlow; run: ManagedRun },
  active?: { flow: RunTaskFlow; run: ManagedRun },
  workspaceEntryIds: Set<string> = new Set(),
): CacheGraphModel {
  const activities = new Map<string, CacheGraphNodeActivity>();
  const projected = planned?.flow.tasks.length
    ? projectTasks(planned.flow.tasks, planned.run, entries, activities)
    : [];
  const mainEntryIds = new Set(projected.map((entry) => entry.id));
  if (active) mergeActiveTasks(projected, entries, active.flow.tasks, active.run, activities);
  const projectedIds = new Set(projected.map((entry) => entry.id));
  for (const entry of entries) {
    if (workspaceEntryIds.has(entry.id) && !projectedIds.has(entry.id)) {
      projected.push(entry);
      projectedIds.add(entry.id);
    }
  }
  if (!projected.length && !workspaceEntryIds.size) projected.push(...entries);
  return { activities, entries: projected, mainEntryIds };
}

function projectTasks(
  tasks: RunTask[],
  run: ManagedRun,
  entries: ManagedCacheEntry[],
  activities: Map<string, CacheGraphNodeActivity>,
): ManagedCacheEntry[] {
  const projected: ManagedCacheEntry[] = [];
  const entryByRunId = new Map(entries.map((entry) => [entry.id, entry]));
  const projectedIdByRunId = new Map<string, string>();
  let previousId: string | undefined;

  for (const task of tasks) {
    const cached = task.runId ? entryByRunId.get(task.runId) : undefined;
    // Completed plans and applies are historical; the cache response is
    // authoritative. If a result referenced by that run is no longer present,
    // it has since been invalidated or cleared.
    const missingHistoricalResult = (
      task.status === "cached" || task.status === "completed"
    ) && Boolean(task.runId) && !cached;
    const entry = cached ?? syntheticEntry(
      task,
      run,
      resolveUpstreamIds(task, entryByRunId, projectedIdByRunId, previousId),
      missingHistoricalResult,
    );
    projected.push(entry);
    if (!entry.invalidated) {
      activities.set(entry.id, { status: task.status, synthetic: !cached });
    }
    if (task.runId) projectedIdByRunId.set(task.runId, entry.id);
    previousId = entry.id;
  }
  return projected;
}

function mergeActiveTasks(
  projected: ManagedCacheEntry[],
  sourceEntries: ManagedCacheEntry[],
  tasks: RunTask[],
  run: ManagedRun,
  activities: Map<string, CacheGraphNodeActivity>,
): void {
  const sourceById = new Map(sourceEntries.map((entry) => [entry.id, entry]));
  let previousId: string | undefined;
  for (const task of tasks) {
    const cached = task.runId ? sourceById.get(task.runId) : undefined;
    const existing = cached
      ? projected.find((entry) => entry.id === cached.id)
      : projected.find((entry) => entry.nodePath === task.nodePath);
    let entry = existing ?? cached ?? syntheticEntry(task, run, task.upstreamRunIds.length ? task.upstreamRunIds : previousId ? [previousId] : []);
    const historicalResultMissing = run.status !== "running" && Boolean(task.runId) && !cached;
    if (historicalResultMissing && !entry.invalidated) {
      entry = { ...entry, invalidated: true };
      if (existing) projected[projected.indexOf(existing)] = entry;
    }
    if (!existing) projected.push(entry);
    // A completed execution is historical once the authoritative cache says
    // its result was invalidated or cleared. Only an execution that is still
    // running may temporarily paint live activity over that cache state.
    if (entry.invalidated && run.status !== "running") {
      activities.delete(entry.id);
    } else {
      activities.set(entry.id, { status: task.status, synthetic: !sourceEntries.some((candidate) => candidate.id === entry.id) });
    }
    previousId = entry.id;
  }
}

function resolveUpstreamIds(
  task: RunTask,
  entryByRunId: Map<string, ManagedCacheEntry>,
  projectedIdByRunId: Map<string, string>,
  previousId: string | undefined,
): string[] {
  const resolved = task.upstreamRunIds.flatMap((id) => {
    const projectedId = projectedIdByRunId.get(id);
    if (projectedId) return [projectedId];
    return entryByRunId.has(id) ? [id] : [];
  });
  return resolved.length ? resolved : previousId ? [previousId] : [];
}

function syntheticEntry(
  task: RunTask,
  run: ManagedRun,
  upstreamRunIds: string[],
  invalidated = false,
): ManagedCacheEntry {
  return {
    id: `run:${run.id}:${task.nodePath}`,
    scope: "planned",
    workflow: run.workflow,
    nodePath: task.nodePath,
    nodeName: task.nodePath,
    nodeKind: "task",
    fingerprint: run.fingerprint,
    upstreamRunIds,
    invalidated,
    createdAt: task.startedAt ?? run.startedAt,
  };
}
