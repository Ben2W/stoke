"use client";

import type { ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { CheckCircle2, ChevronRight, CircleDashed, History, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { RunCapabilityAction } from "../../../../runs/_components/run-capability-action.tsx";
import { formatRunDuration } from "../../../../runs/_components/run-duration.ts";
import { RunEventList } from "../../../../runs/_components/run-event-list.tsx";
import { useRunObserver } from "../../../../runs/_components/use-run-observer.ts";

export function WorkspaceRunHistory({ className = "mt-8", projectId, workspace }: { className?: string; projectId: string; workspace: ManagedWorkspace }) {
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const observed = useRunObserver(selectedRunId);
  const runs = useMemo(
    () => (observed.runsResult.data ?? []).filter((run) => run.projectId === projectId && run.workspace === workspace.name),
    [observed.runsResult.data, projectId, workspace.name],
  );

  return (
    <section className={className} aria-labelledby="workspace-history-heading">
      <div>
        <h2 className="text-sm font-medium" id="workspace-history-heading">Run history</h2>
        <p className="mt-1 text-xs text-zinc-500">Select a run to reopen its live task flow and any pending action.</p>
      </div>
      <div className={`mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white ${selectedRunId ? "grid lg:grid-cols-[20rem_1fr]" : ""}`}>
        <div className={selectedRunId ? "border-b border-zinc-200 lg:border-b-0 lg:border-r" : ""}>
          {observed.runsResult.isPending ? <HistorySkeleton /> : runs.length ? runs.map((run, index) => (
            <button
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 ${index ? "border-t border-zinc-100" : ""} ${selectedRunId === run.id ? "bg-zinc-50" : ""}`}
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              type="button"
            >
              <StatusIcon run={run} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-900">{runTitle(run)}</span>
                <span className="mt-0.5 block truncate text-[10px] text-zinc-400">{formatDate(run.startedAt)} · {run.status === "running" ? "running" : formatRunDuration(run)}</span>
              </span>
              <ChevronRight className="shrink-0 text-zinc-300" size={14} />
            </button>
          )) : (
            <div className="px-6 py-8 text-center">
              <History className="mx-auto text-zinc-300" size={18} />
              <p className="mt-2 text-xs text-zinc-500">No operations have run on this workspace yet.</p>
            </div>
          )}
        </div>
        {selectedRunId ? (
          observed.run ? (
            observed.eventsResult.isPending ? <RunDetailSkeleton /> : observed.eventsResult.isError ? (
              <button className="h-[32rem] text-sm text-zinc-500" onClick={() => void observed.eventsResult.refetch()} type="button">Could not load events. Try again.</button>
            ) : (
              <RunEventList
                action={<RunCapabilityAction events={observed.eventsResult.data} run={observed.run} />}
                events={observed.eventsResult.data}
                run={observed.run}
                title={runTitle(observed.run)}
              />
            )
          ) : <RunDetailSkeleton />
        ) : null}
      </div>
    </section>
  );
}

function StatusIcon({ run }: { run: ManagedRun }) {
  if (run.status === "running") return <CircleDashed className="shrink-0 animate-spin text-blue-600" size={14} />;
  if (run.status === "completed") return <CheckCircle2 className="shrink-0 text-emerald-600" size={14} />;
  return <XCircle className="shrink-0 text-red-600" size={14} />;
}

function runTitle(run: ManagedRun): string {
  if (run.operation === "run") return run.workspaceOperation ?? "Workspace operation";
  if (run.operation === "create") return "Created workspace";
  if (run.operation === "remove") return "Removed workspace";
  return `${run.operation} · ${run.workflow}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function HistorySkeleton() {
  return <div className="space-y-3 p-4">{Array.from({ length: 3 }, (_, index) => <div className="h-9 animate-pulse rounded bg-zinc-100" key={index} />)}</div>;
}

function RunDetailSkeleton() {
  return <div className="h-[32rem] animate-pulse bg-zinc-50" />;
}
