import type { ManagedProject, ManagedRun } from "@stoke/managed";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { shortFingerprint } from "../../lib/fingerprint.ts";
import { runOriginLabel } from "./run-origin.ts";

type RunListProps = {
  projects: ManagedProject[];
  runs: ManagedRun[];
  selectedRunId?: string;
  onSelect(runId: string): void;
};

export function RunList({ projects, runs, selectedRunId, onSelect }: RunListProps) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <div className="divide-y divide-zinc-100 lg:max-h-[28rem] lg:overflow-y-auto">
      {runs.map((run) => (
        <button
          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${selectedRunId === run.id ? "bg-zinc-50" : "hover:bg-zinc-50/70"}`}
          key={run.id}
          onClick={() => onSelect(run.id)}
          type="button"
        >
          <RunStatusIcon status={run.status} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <strong className="truncate text-xs font-medium text-zinc-900">{projectNames.get(run.projectId) ?? "Unknown project"}</strong>
              <time className="shrink-0 text-[10px] text-zinc-400">{formatRunTime(run.startedAt)}</time>
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="truncate">{run.workflow}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{runOriginLabel(run)}</span>
              <span aria-hidden="true">·</span>
              <code className="truncate font-mono" title={run.fingerprint}>{shortFingerprint(run.fingerprint)}</code>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function RunStatusIcon({ status }: { status: ManagedRun["status"] }) {
  if (status === "running") return <CircleDashed className="mt-0.5 shrink-0 animate-spin text-blue-600" size={15} />;
  if (status === "completed") return <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={15} />;
  return <XCircle className="mt-0.5 shrink-0 text-red-600" size={15} />;
}

function formatRunTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
