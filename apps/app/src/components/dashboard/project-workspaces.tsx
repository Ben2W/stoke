"use client";

import type { ManagedProject, ManagedWorkspace } from "@usestoke/managed";
import { useQuery } from "@tanstack/react-query";
import { Box, LayoutDashboard, Laptop, MapPin } from "lucide-react";
import { projectWorkspacesQuery } from "../../lib/queries.ts";

export function ProjectWorkspaces({ project }: { project: ManagedProject }) {
  const workspaces = useQuery(projectWorkspacesQuery(project.id));

  return (
    <section aria-labelledby="workspaces-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium" id="workspaces-heading">Workspaces</h2>
          <p className="mt-1 text-xs text-zinc-500">Managed project state, independent of any machine or checkout.</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-zinc-400">{workspaces.data?.length ?? 0} total</span>
      </div>

      {workspaces.isPending ? (
        <div className="h-32 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      ) : workspaces.isError ? (
        <button className="grid h-32 w-full place-items-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-500" onClick={() => void workspaces.refetch()} type="button">Could not load workspaces. Try again.</button>
      ) : workspaces.data.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.data.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} />)}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
          <Box className="mx-auto text-zinc-300" size={21} />
          <p className="mt-3 text-sm font-medium text-zinc-800">No workspaces yet</p>
          <p className="mt-1 text-xs text-zinc-500">Create one from a local checkout; it will remain available as managed project state.</p>
        </div>
      )}
    </section>
  );
}

function WorkspaceCard({ workspace }: { workspace: ManagedWorkspace }) {
  const provenance = workspace.createdFrom;
  const fromDashboard = provenance.kind === "dashboard";
  const title = fromDashboard
    ? "Created from Stoke dashboard"
    : `Created from ${provenance.deviceName}`;
  const detail = !fromDashboard ? provenance.checkoutPath : undefined;

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Box size={15} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-900">{workspace.name}</h3>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">{workspace.workflow}</p>
        </div>
        <time className="shrink-0 text-[10px] text-zinc-400">{relativeTime(workspace.updatedAt)}</time>
      </div>
      <div className="mt-4 flex min-w-0 items-start gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
        {fromDashboard ? <LayoutDashboard className="mt-0.5 shrink-0" size={12} /> : <Laptop className="mt-0.5 shrink-0" size={12} />}
        <span className="min-w-0">
          <span className="block truncate">{title}</span>
          {detail ? <span className="mt-0.5 flex items-center gap-1 truncate text-zinc-400"><MapPin size={10} /> {detail}</span> : null}
        </span>
      </div>
    </article>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}
