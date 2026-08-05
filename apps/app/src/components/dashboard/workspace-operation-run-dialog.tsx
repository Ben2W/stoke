"use client";

import type { ManagedRun, ManagedRunEvent, ManagedWorkspace } from "@usestoke/managed";
import { CircleDashed, Terminal, X } from "lucide-react";
import { RunCapabilityAction } from "./run-capability-action.tsx";
import { RunEventList } from "./run-event-list.tsx";

type WorkspaceOperation = ManagedWorkspace["operations"][number];

export function WorkspaceOperationRunDialog({ error, events, onClose, operation, pending, run }: {
  error?: string;
  events: ManagedRunEvent[];
  onClose(): void;
  operation: WorkspaceOperation;
  pending: boolean;
  run?: ManagedRun;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 px-4 backdrop-blur-[2px]" role="presentation">
      <section aria-labelledby="workspace-operation-run-title" aria-modal="true" className="w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <header className="flex items-start justify-between border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Terminal className="text-zinc-400" size={14} />
              <h2 className="truncate text-sm font-semibold" id="workspace-operation-run-title">{operation.title ?? operation.id}</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{operation.description ?? `Running ${operation.id}`}</p>
          </div>
          <button aria-label="Close operation" className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={onClose} type="button"><X size={16} /></button>
        </header>

        {run ? (
          <RunEventList
            action={<RunCapabilityAction events={events} run={run} />}
            events={events}
            run={run}
            title={operation.title ?? operation.id}
          />
        ) : (
          <div className="flex h-[32rem] flex-col">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 text-xs text-zinc-600">
              <CircleDashed className={pending ? "animate-spin text-blue-500" : "text-red-500"} size={13} />
              {error ?? `Starting ${operation.title ?? operation.id}…`}
            </div>
            <div className="m-5 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-[11px] leading-5 text-zinc-400">
              {error ? <span className="text-red-300">{error}</span> : <span>Waiting for the first event…</span>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
