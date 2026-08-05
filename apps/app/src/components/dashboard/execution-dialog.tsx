import type { ManagedProject, ManagedRunOperation } from "@stoke/managed";
import { GitBranch, X } from "lucide-react";
import { useEffect } from "react";
import { shortFingerprint } from "../../lib/fingerprint.ts";
import { RunEventListSkeleton } from "./run-event-list-skeleton.tsx";
import { RunEventList } from "./run-event-list.tsx";
import { useRunObserver } from "./use-run-observer.ts";

export function ExecutionDialog({
  error,
  operation,
  project,
  runId,
  starting,
  onClose,
}: {
  error?: Error;
  operation: ManagedRunOperation;
  project: ManagedProject;
  runId?: string;
  starting: boolean;
  onClose(): void;
}) {
  const { eventsResult, run } = useRunObserver(runId);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const source = project.source.kind === "github"
    ? `${project.source.owner}/${project.source.repository}`
    : project.name;
  const running = starting || run?.status === "running";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 px-3 py-6 backdrop-blur-[2px] sm:px-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="execution-dialog-title"
        aria-modal="true"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight" id="execution-dialog-title">
                {executionTitle(operation, run?.status, starting)}
              </h2>
              {run ? (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium ${run.status === "running" ? "bg-blue-50 text-blue-700" : run.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`} title={run.fingerprint}>
                  {run.status === "running" ? <span className="size-1.5 animate-pulse rounded-full bg-blue-500" /> : null}
                  {operation === "apply" ? "Applying" : "Planning"} {shortFingerprint(run.fingerprint)}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-zinc-500">
              <GitBranch size={12} /> {source} · Vercel Sandbox
            </p>
          </div>
          <button aria-label="Close execution dialog" className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" onClick={onClose} type="button"><X size={17} /></button>
        </header>

        <div className="min-h-0 overflow-y-auto">
          {error ? (
            <div className="grid h-[32rem] place-items-center px-6 text-center">
              <div className="max-w-md">
                <div className="mx-auto grid size-9 place-items-center rounded-full bg-red-50 text-red-600"><X size={16} /></div>
                <h3 className="mt-3 text-sm font-medium text-zinc-900">Could not start {operation}</h3>
                <p className="mt-1.5 text-xs leading-5 text-red-600">{error.message}</p>
              </div>
            </div>
          ) : starting || !run ? (
            <RunEventListSkeleton />
          ) : eventsResult.isPending ? (
            <RunEventListSkeleton />
          ) : eventsResult.isError ? (
            <button className="h-[32rem] w-full text-sm text-zinc-500" onClick={() => void eventsResult.refetch()} type="button">Could not load run events. Try again.</button>
          ) : (
            <RunEventList events={eventsResult.data} run={run} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 sm:px-6">
          <p className="text-[11px] text-zinc-500">
            {running ? "This run continues if you close the dialog." : "The complete event log remains available under Runs."}
          </p>
          <button className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50" onClick={onClose} type="button">
            {running ? "Run in background" : "Close"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function executionTitle(
  operation: ManagedRunOperation,
  status: "running" | "completed" | "failed" | "orphaned" | undefined,
  starting: boolean,
): string {
  const action = operation === "apply" ? "Apply" : "Plan";
  if (starting || status === "running" || !status) return `${action} in progress`;
  if (status === "completed") return `${action} completed`;
  return `${action} failed`;
}
