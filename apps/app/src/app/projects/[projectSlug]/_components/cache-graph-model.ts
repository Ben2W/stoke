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
    : [...entries];

  if (active) mergeActiveTasks(projected, entries, active.flow.tasks, active.run, activities);
  const mainEntryIds = new Set(projected.map((entry) => entry.id));
  for (const entry of entries) {
    if (workspaceEntryIds.has(entry.id) && !mainEntryIds.has(entry.id)) projected.push(entry);
  }
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
    const entry = cached ?? syntheticEntry(task, run, resolveUpstreamIds(task, entryByRunId, projectedIdByRunId, previousId));
    projected.push(entry);
    activities.set(entry.id, { status: task.status, synthetic: !cached });
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
    const existing = projected.find((entry) => entry.nodePath === task.nodePath);
    const cached = task.runId ? sourceById.get(task.runId) : undefined;
    const entry = existing ?? cached ?? syntheticEntry(task, run, task.upstreamRunIds.length ? task.upstreamRunIds : previousId ? [previousId] : []);
    if (!existing) projected.push(entry);
    activities.set(entry.id, { status: task.status, synthetic: !sourceEntries.some((candidate) => candidate.id === entry.id) });
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

function syntheticEntry(task: RunTask, run: ManagedRun, upstreamRunIds: string[]): ManagedCacheEntry {
  return {
    id: `run:${run.id}:${task.nodePath}`,
    scope: "planned",
    workflow: run.workflow,
    nodePath: task.nodePath,
    nodeName: task.nodePath,
    nodeKind: "task",
    fingerprint: run.fingerprint,
    upstreamRunIds,
    invalidated: false,
    createdAt: task.startedAt ?? run.startedAt,
  };
}
