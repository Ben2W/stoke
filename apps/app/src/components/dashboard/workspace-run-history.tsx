"use client";

import type { ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, FileText, History, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { runEventsQuery, runsQuery } from "../../lib/queries.ts";
import { formatRunDuration } from "./run-duration.ts";
import { RunLogsDialog } from "./run-logs-dialog.tsx";

export function WorkspaceRunHistory({ workspace }: { workspace: ManagedWorkspace }) {
  const runsResult = useQuery(runsQuery);
  const [selectedRun, setSelectedRun] = useState<ManagedRun>();
  const eventsResult = useQuery(runEventsQuery(selectedRun?.id));
  const runs = useMemo(
    () => (runsResult.data ?? []).filter((run) => run.workspace === workspace.name),
    [runsResult.data, workspace.name],
  );

  return (
    <section className="mt-8" aria-labelledby="workspace-history-heading">
      <div>
        <h2 className="text-sm font-medium" id="workspace-history-heading">Run history</h2>
        <p className="mt-1 text-xs text-zinc-500">Console output and failure logs retained for this workspace.</p>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {runsResult.isPending ? <HistorySkeleton /> : runs.length ? runs.map((run, index) => (
          <div className={`flex items-center gap-3 px-4 py-3 ${index ? "border-t border-zinc-100" : ""}`} key={run.id}>
            <StatusIcon run={run} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-900">{runTitle(run)}</p>
              <p className="mt-0.5 truncate text-[10px] text-zinc-400">{formatDate(run.startedAt)} · {run.status === "running" ? "running" : formatRunDuration(run)}</p>
            </div>
            <button className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50" onClick={() => setSelectedRun(run)} type="button"><FileText size={11} /> View logs</button>
          </div>
        )) : (
          <div className="px-6 py-8 text-center">
            <History className="mx-auto text-zinc-300" size={18} />
            <p className="mt-2 text-xs text-zinc-500">No operations have run on this workspace yet.</p>
          </div>
        )}
      </div>
      {selectedRun ? <RunLogsDialog events={eventsResult.data ?? []} loading={eventsResult.isPending} onClose={() => setSelectedRun(undefined)} run={selectedRun} /> : null}
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
