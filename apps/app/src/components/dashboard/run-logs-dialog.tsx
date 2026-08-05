"use client";

import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { Check, Clipboard, FileText, X } from "lucide-react";
import { useMemo, useState } from "react";
import { projectRunLogs, runLogsText } from "./run-logs.ts";

export function RunLogsDialog({ events, loading = false, onClose, run }: {
  events: ManagedRunEvent[];
  loading?: boolean;
  onClose(): void;
  run: ManagedRun;
}) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => projectRunLogs(events, run), [events, run]);
  const copy = async () => {
    await navigator.clipboard.writeText(runLogsText(lines));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-zinc-950/50 px-4 backdrop-blur-[2px]" role="presentation">
      <section aria-labelledby="run-logs-title" aria-modal="true" className="flex h-[min(44rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl" role="dialog">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="text-zinc-500" size={14} />
              <h2 className="truncate text-sm font-semibold text-zinc-100" id="run-logs-title">Run logs</h2>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide ${run.status === "completed" ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>{run.status}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-zinc-500">{run.workspace ? `${run.workspace} · ` : ""}{run.operation} · {run.id}</p>
          </div>
          <div className="flex items-center gap-1">
            <button className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40" disabled={!lines.length} onClick={() => void copy()} type="button">{copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? "Copied" : "Copy"}</button>
            <button aria-label="Close logs" className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100" onClick={onClose} type="button"><X size={15} /></button>
          </div>
        </header>
        <div className="flex-1 overflow-auto px-5 py-4 font-mono text-[11px] leading-5">
          {loading ? <LogsSkeleton /> : lines.length ? lines.map((line) => (
            <div className="grid grid-cols-[5.25rem_8rem_minmax(0,1fr)] gap-3" key={line.id}>
              <time className="select-none text-zinc-600">{formatTime(line.timestamp)}</time>
              <span className="truncate text-zinc-600" title={line.source}>{line.source}</span>
              <pre className={`whitespace-pre-wrap break-words ${line.stream === "error" || line.stream === "stderr" ? "text-red-300" : line.stream === "stdout" ? "text-zinc-200" : "text-zinc-400"}`}>{line.message.trimEnd()}</pre>
            </div>
          )) : <p className="text-zinc-500">No console output was recorded for this run.</p>}
        </div>
      </section>
    </div>
  );
}

function LogsSkeleton() {
  return <div className="space-y-3">{Array.from({ length: 8 }, (_, index) => <div className="h-3 animate-pulse rounded bg-zinc-900" key={index} style={{ width: `${55 + (index % 4) * 10}%` }} />)}</div>;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
