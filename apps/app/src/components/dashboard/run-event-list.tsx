import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { CircleDashed, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { shortFingerprint } from "../../lib/fingerprint.ts";
import { runOriginLabel } from "./run-origin.ts";
import { projectRunTaskFlow } from "./run-task-flow.ts";
import { RunTaskFlowView } from "./run-task-flow-view.tsx";
import { formatRunDuration } from "./run-duration.ts";
import { RunLogsDialog } from "./run-logs-dialog.tsx";

export function RunEventList({ action, events, run, title }: { action?: ReactNode; events: ManagedRunEvent[]; run: ManagedRun; title?: string }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [showLogs, setShowLogs] = useState(false);
  useEffect(() => {
    if (run.status === "running") timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length, run.status]);

  const flow = projectRunTaskFlow(events, run);
  const nodeCount = run.nodeCount ?? Math.max(flow.tasks.length, 1);
  const progress = run.status === "completed" ? 100 : Math.min(100, Math.round((flow.completedTaskCount / nodeCount) * 100));
  return (
    <div className="flex h-[32rem] flex-col">
      <div className="border-b border-zinc-100 px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-900">{title ?? `${run.operation} · ${run.workflow}`}</p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              {runOriginLabel(run)} · <code className="font-mono" title={run.fingerprint}>{shortFingerprint(run.fingerprint)}</code> · {run.id.slice(0, 8)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {run.status === "failed" || run.status === "orphaned" ? <button className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50" onClick={() => setShowLogs(true)} type="button"><FileText size={11} /> View logs</button> : null}
            <StatusBadge run={run} />
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
      </div>

      {events.length ? (
        <div className="max-h-[28rem] flex-1 overflow-y-auto px-5 py-5" ref={timelineRef}>
          <RunTaskFlowView flow={flow} run={run} />
        </div>
      ) : (
        <div className="grid flex-1 place-items-center px-6 py-14 text-center">
          <div>
            <CircleDashed className={`mx-auto text-zinc-300 ${run.status === "running" ? "animate-spin" : ""}`} size={22} />
            <p className="mt-3 text-xs text-zinc-500">{run.status === "running" ? "Waiting for the first event…" : "No event details were recorded."}</p>
          </div>
        </div>
      )}
      {action}
      {showLogs ? <RunLogsDialog events={events} onClose={() => setShowLogs(false)} run={run} /> : null}
    </div>
  );
}

function StatusBadge({ run }: { run: ManagedRun }) {
  const status = run.status;
  const styles = status === "running"
    ? "bg-blue-50 text-blue-700"
    : status === "completed"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium capitalize ${styles}`}>
      {status === "running" ? <span className="size-1.5 animate-pulse rounded-full bg-blue-500" /> : null}
      {status === "completed" ? `Completed in ${formatRunDuration(run)}` : status}
    </span>
  );
}
