"use client";

import type { ManagedProject } from "@usestoke/managed";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { RunEventListSkeleton } from "./run-event-list-skeleton.tsx";
import { RunEventList } from "./run-event-list.tsx";
import { RunCapabilityAction } from "./run-capability-action.tsx";
import { RunList } from "./run-list.tsx";
import { useRunObserver } from "./use-run-observer.ts";

export function RunActivity({ className = "mt-8", project }: { className?: string; project: ManagedProject }) {
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const { eventsResult, run: selectedRun, runsResult } = useRunObserver(selectedRunId);
  const runs = (runsResult.data ?? []).filter((run) => run.projectId === project.id);

  useEffect(() => {
    const activeRun = runs.find((run) => run.status === "running");
    if (activeRun && selectedRun?.status !== "running") {
      setSelectedRunId(activeRun.id);
      return;
    }
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(activeRun?.id ?? runs[0]?.id);
  }, [runs, selectedRun?.status, selectedRunId]);

  return (
    <section className={className} aria-labelledby="activity-heading">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium" id="activity-heading">Runs</h2>
          <p className="mt-1 text-xs text-zinc-500">The same live execution stream shown by the CLI.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400"><span className="size-1.5 rounded-full bg-emerald-500" /> Postgres + live updates</span>
      </div>

      {runs.length && selectedRun ? (
        <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs lg:grid-cols-[20rem_1fr]">
          <div className="border-b border-zinc-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-zinc-100 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Recent runs</div>
            <RunList onSelect={setSelectedRunId} projects={[project]} runs={runs} selectedRunId={selectedRunId} />
          </div>
          {eventsResult.isPending ? (
            <RunEventListSkeleton />
          ) : eventsResult.isError ? (
            <button className="h-[32rem] text-sm text-zinc-500" onClick={() => void eventsResult.refetch()} type="button">Could not load events. Try again.</button>
          ) : (
            <RunEventList action={<RunCapabilityAction events={eventsResult.data} run={selectedRun} />} events={eventsResult.data} run={selectedRun} />
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
          <Activity className="mx-auto text-zinc-300" size={21} />
          <p className="mt-3 text-sm font-medium text-zinc-800">No managed runs yet</p>
          <p className="mt-1 text-xs text-zinc-500">Run <code className="rounded bg-zinc-100 px-1.5 py-0.5">stoke apply</code> in a linked checkout.</p>
        </div>
      )}
    </section>
  );
}
