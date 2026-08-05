"use client";

import type { ManagedCacheEntry, ManagedProject } from "@usestoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clearProjectCache, invalidateProjectCacheEntry } from "../../lib/api-client.ts";
import { projectCacheQuery, queryKeys, runsQuery } from "../../lib/queries.ts";
import { CacheActions } from "./cache-actions.tsx";
import { CacheGraph, CacheGraphSkeleton } from "./cache-graph.tsx";
import { projectRunTaskFlow } from "./run-task-flow.ts";
import { useRunObserver } from "./use-run-observer.ts";

export function ProjectCache({ project }: { project: ManagedProject }) {
  const projectId = project.id;
  const queryClient = useQueryClient();
  const cache = useQuery(projectCacheQuery(projectId));
  const entries = cache.data?.entries ?? [];
  const runsResult = useQuery(runsQuery);
  const projectRuns = (runsResult.data ?? []).filter((run) => run.projectId === projectId);
  const activeRun = projectRuns.find((run) => run.status === "running");
  const [bridgingRunId, setBridgingRunId] = useState<string>();
  const executionRun = activeRun ?? projectRuns.find((run) => run.id === bridgingRunId);
  const latestPlan = projectRuns.find((run) => run.operation === "plan" && run.status === "completed");
  const latestApply = projectRuns.find((run) => run.operation === "apply" && run.status === "completed");
  const plannedRun = latestPlan && (!latestApply || latestPlan.startedAt > latestApply.startedAt) ? latestPlan : undefined;
  const { eventsResult: executionEventsResult } = useRunObserver(executionRun?.id);
  const { eventsResult: planEventsResult } = useRunObserver(plannedRun?.id);
  const executionFlow = useMemo(
    () => executionRun ? projectRunTaskFlow(executionEventsResult.data ?? [], executionRun) : undefined,
    [executionRun, executionEventsResult.data],
  );
  const plannedFlow = useMemo(
    () => plannedRun ? projectRunTaskFlow(planEventsResult.data ?? [], plannedRun) : undefined,
    [plannedRun, planEventsResult.data],
  );

  useEffect(() => {
    if (activeRun) setBridgingRunId(activeRun.id);
  }, [activeRun]);

  useEffect(() => {
    if (activeRun || !executionRun || !executionFlow) return;
    if (executionRun.operation === "plan" && plannedRun?.id === executionRun.id) {
      setBridgingRunId(undefined);
      return;
    }
    const completeFlowLoaded = executionRun.nodeCount !== undefined
      && executionFlow.tasks.length >= executionRun.nodeCount;
    const materialized = executionRun.operation === "apply"
      && executionRun.status === "completed"
      && completeFlowLoaded
      && executionFlow.tasks.every((task) =>
        (task.status === "cached" || task.status === "completed")
        && Boolean(task.runId)
        && entries.some((entry) => entry.id === task.runId)
      );
    if (materialized) setBridgingRunId(undefined);
  }, [activeRun, entries, executionFlow, executionRun, plannedRun?.id]);
  const [confirmClear, setConfirmClear] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.projectCache(projectId) });
  const invalidate = useMutation({
    mutationFn: (entry: ManagedCacheEntry) => invalidateProjectCacheEntry(projectId, {
      scope: entry.scope,
      entryId: entry.id,
    }),
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: () => clearProjectCache(projectId),
    onSuccess: () => {
      setConfirmClear(false);
      void refresh();
    },
  });
  return (
    <section className="mt-8" aria-labelledby="cache-heading">
      <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-sm font-medium" id="cache-heading">Cache</h2>
          <p className="mt-1 text-xs text-zinc-500">Shared node results and their cascading dependencies across local and Vercel Sandbox runs.</p>
        </div>
        <div className="flex items-start gap-2">
          {entries.length ? (
            <button
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] transition ${confirmClear ? "border-red-200 bg-red-50 text-red-700" : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"}`}
              disabled={clear.isPending || Boolean(activeRun)}
              onClick={() => confirmClear ? clear.mutate() : setConfirmClear(true)}
              onBlur={() => setConfirmClear(false)}
              type="button"
            >
              <Trash2 size={12} /> {clear.isPending ? "Clearing…" : confirmClear ? "Confirm clear" : "Clear all"}
            </button>
          ) : null}
          <CacheActions activeRun={activeRun} project={project} />
        </div>
      </div>

      {cache.isPending ? (
        <CacheGraphSkeleton />
      ) : cache.isError ? (
        <button className="grid h-28 w-full place-items-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-500" onClick={() => void cache.refetch()} type="button">Could not load cache. Try again.</button>
      ) : entries.length || executionRun || plannedFlow?.tasks.length ? (
        <CacheGraph
          activeFlow={executionFlow}
          activeRun={executionRun}
          entries={entries}
          invalidatingId={invalidate.isPending ? invalidate.variables?.id : undefined}
          onInvalidate={(entry) => invalidate.mutate(entry)}
          plannedFlow={plannedFlow}
          plannedRun={plannedRun}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-7 text-center">
          <Database className="mx-auto text-zinc-300" size={20} />
          <p className="mt-2 text-xs text-zinc-500">No reusable node results yet. Plan or apply this project to populate the shared cache.</p>
        </div>
      )}
      {invalidate.isError || clear.isError ? <p className="mt-2 text-xs text-red-600">{(invalidate.error ?? clear.error)?.message}</p> : null}
    </section>
  );
}
