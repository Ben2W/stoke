"use client";

import type { ManagedProject, ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Box, ChevronRight, CircleDashed, LayoutDashboard, Laptop, LoaderCircle, MapPin, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { projectWorkspacesQuery, queryKeys, runsQuery } from "../../../../lib/queries.ts";
import { CreateWorkspaceDialog } from "./create-workspace-dialog.tsx";
import { unmatchedActiveRemovals, workspaceRemovalFor } from "./workspace-removals.ts";

export function ProjectWorkspaces({ project, onSelect }: { project: ManagedProject; onSelect(workspaceId: string): void }) {
  const queryClient = useQueryClient();
  const workspaces = useQuery(projectWorkspacesQuery(project.id));
  const runs = useQuery(runsQuery);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingWorkspace[]>([]);
  const refreshedRemovals = useRef(new Set<string>());
  const projectRuns = useMemo(
    () => (runs.data ?? []).filter((run) => run.projectId === project.id),
    [project.id, runs.data],
  );
  const visiblePending = pending.filter((item) =>
    !workspaces.data?.some((workspace) => workspace.name === item.name)
  );
  const pendingRemovals = unmatchedActiveRemovals(projectRuns, workspaces.data ?? []);
  const total = (workspaces.data?.length ?? 0) + visiblePending.length + pendingRemovals.length;

  useEffect(() => {
    if (!workspaces.data) return;
    setPending((current) => current.filter((item) =>
      !workspaces.data.some((workspace) => workspace.name === item.name)
    ));
  }, [workspaces.data]);

  useEffect(() => {
    const terminalRemovals = projectRuns.filter((run) =>
      run.operation === "remove" && run.status !== "running" && !refreshedRemovals.current.has(run.id)
    );
    if (!terminalRemovals.length) return;
    for (const run of terminalRemovals) refreshedRemovals.current.add(run.id);
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
  }, [project.id, projectRuns, queryClient]);

  return (
    <section aria-labelledby="workspaces-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium" id="workspaces-heading">Workspaces</h2>
          <p className="mt-1 text-xs text-zinc-500">Managed project state, independent of any machine or checkout.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-xs tabular-nums text-zinc-400">{total} total</span>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-[11px] font-medium text-white transition hover:bg-zinc-800" onClick={() => setCreating(true)} type="button"><Plus size={12} /> Create workspace</button>
        </div>
      </div>

      {workspaces.isPending ? (
        pendingRemovals.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pendingRemovals.map((run) => <RemovingWorkspaceCard key={run.id} run={run} />)}
          </div>
        ) : <div className="h-32 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      ) : workspaces.isError ? (
        <button className="grid h-32 w-full place-items-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-500" onClick={() => void workspaces.refetch()} type="button">Could not load workspaces. Try again.</button>
      ) : workspaces.data.length || visiblePending.length || pendingRemovals.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiblePending.map((item) => (
            <PendingWorkspaceCard
              key={item.runId}
              onDismiss={() => setPending((current) => current.filter((candidate) => candidate.runId !== item.runId))}
              pending={item}
              run={projectRuns.find((run) => run.id === item.runId)}
            />
          ))}
          {pendingRemovals.map((run) => <RemovingWorkspaceCard key={run.id} run={run} />)}
          {workspaces.data.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              onSelect={() => onSelect(workspace.id)}
              removal={workspaceRemovalFor(projectRuns, workspace)}
              workspace={workspace}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
          <Box className="mx-auto text-zinc-300" size={21} />
          <p className="mt-3 text-sm font-medium text-zinc-800">No workspaces yet</p>
          <p className="mt-1 text-xs text-zinc-500">Create one here in Vercel Sandbox or attach one from a local checkout.</p>
          <button className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-[11px] font-medium text-white" onClick={() => setCreating(true)} type="button"><Plus size={12} /> Create workspace</button>
        </div>
      )}
      <CreateWorkspaceDialog
        existingNames={[
          ...(workspaces.data ?? []).map((workspace) => workspace.name),
          ...visiblePending.map((workspace) => workspace.name),
        ]}
        onClose={() => setCreating(false)}
        onStarted={(item) => setPending((current) => [item, ...current.filter((candidate) => candidate.runId !== item.runId)])}
        open={creating}
        project={project}
      />
    </section>
  );
}

function RemovingWorkspaceCard({ run }: { run: ManagedRun }) {
  return (
    <article className="cursor-wait rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-xs">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-600"><LoaderCircle className="animate-spin" size={15} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-900">{run.workspace}</h3>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">{run.workflow}</p>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-amber-700">Removing…</span>
      </div>
      <div className="mt-4 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">Running workspace remove handler…</div>
    </article>
  );
}

type PendingWorkspace = { name: string; runId: string };

function PendingWorkspaceCard({ onDismiss, pending, run }: {
  onDismiss(): void;
  pending: PendingWorkspace;
  run?: ManagedRun;
}) {
  const failed = run?.status === "failed" || run?.status === "orphaned";
  const finishing = run?.status === "completed";
  const workflow = run?.workflow !== "default" ? run?.workflow : undefined;
  return (
    <article className={`rounded-lg border bg-white p-4 shadow-xs ${failed ? "border-red-200" : "border-zinc-200"}`}>
      <div className="flex items-start gap-3">
        <div className={`grid size-8 shrink-0 place-items-center rounded-md ${failed ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"}`}>
          {failed ? <X size={15} /> : <CircleDashed className="animate-spin" size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-900">{pending.name}</h3>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">{workflow ?? "Discovering workflow…"}</p>
        </div>
        {failed ? <button aria-label={`Dismiss ${pending.name}`} className="text-zinc-400 hover:text-zinc-700" onClick={onDismiss} type="button"><X size={14} /></button> : <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />}
      </div>
      <div className={`mt-4 border-t pt-3 text-[11px] ${failed ? "border-red-100 text-red-600" : "border-zinc-100 text-zinc-500"}`}>
        {failed ? run?.error ?? "Workspace creation failed" : finishing ? "Saving managed workspace…" : "Creating in Vercel Sandbox…"}
      </div>
    </article>
  );
}

function WorkspaceCard({ workspace, onSelect, removal }: {
  workspace: ManagedWorkspace;
  onSelect(): void;
  removal?: ManagedRun;
}) {
  const provenance = workspace.createdFrom;
  const fromDashboard = provenance.kind === "dashboard";
  const removing = removal?.status === "running" || removal?.status === "completed";
  const removalFailed = removal?.status === "failed" || removal?.status === "orphaned";
  const title = fromDashboard
    ? "Created from Stoke dashboard"
    : `Created from ${provenance.deviceName}`;
  const detail = !fromDashboard ? provenance.checkoutPath : undefined;

  return (
    <button
      className={`group rounded-lg border bg-white p-4 text-left shadow-xs transition ${
        removalFailed ? "border-red-200 hover:border-red-300" : removing ? "cursor-wait border-zinc-200" : "border-zinc-200 hover:border-zinc-300 hover:shadow-sm"
      }`}
      disabled={removing}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div className={`grid size-8 shrink-0 place-items-center rounded-md ${removalFailed ? "bg-red-50 text-red-500" : removing ? "bg-amber-50 text-amber-600" : "bg-zinc-100 text-zinc-500"}`}>
          {removalFailed ? <AlertCircle size={15} /> : removing ? <LoaderCircle className="animate-spin" size={15} /> : <Box size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-900">{workspace.name}</h3>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">
            {workspace.workflow}{workspace.sourceRevision ? ` · ${workspace.sourceRevision.slice(0, 7)}` : ""}
          </p>
        </div>
        {removing ? <span className="shrink-0 text-[10px] font-medium text-amber-700">Removing…</span> : <time className="shrink-0 text-[10px] text-zinc-400">{relativeTime(workspace.updatedAt)}</time>}
        {!removing ? <ChevronRight className="shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-zinc-500" size={14} /> : null}
      </div>
      {removalFailed ? (
        <div className="mt-4 border-t border-red-100 pt-3 text-[11px] text-red-600">
          <span className="font-medium">Removal failed.</span> {removal.error ?? "Open the workspace to try again."}
        </div>
      ) : (
        <div className="mt-4 flex min-w-0 items-start gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
          {fromDashboard ? <LayoutDashboard className="mt-0.5 shrink-0" size={12} /> : <Laptop className="mt-0.5 shrink-0" size={12} />}
          <span className="min-w-0">
            <span className="block truncate">{removing ? "Running workspace remove handler…" : title}</span>
            {!removing && detail ? <span className="mt-0.5 flex items-center gap-1 truncate text-zinc-400"><MapPin size={10} /> {detail}</span> : null}
          </span>
        </div>
      )}
    </button>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}
