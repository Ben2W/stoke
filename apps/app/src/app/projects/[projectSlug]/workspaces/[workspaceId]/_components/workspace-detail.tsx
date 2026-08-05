"use client";

import type { ManagedProject, ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, Box, CircleDashed, LayoutDashboard, Laptop, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { executeProjectRequest } from "../../../../../../lib/api-client.ts";
import { projectWorkspacesQuery, queryKeys, runsQuery } from "../../../../../../lib/queries.ts";
import { dashboardRoutes } from "../../../../../../lib/routes.ts";
import { WorkspaceOperations } from "./workspace-operations.tsx";

export function WorkspaceDetail({ project, workspaceId }: { project: ManagedProject; workspaceId: string }) {
  const workspaces = useQuery(projectWorkspacesQuery(project.id));
  if (workspaces.isPending) return <WorkspaceDetailSkeleton />;
  if (workspaces.isError) return <button className="text-sm text-zinc-500" onClick={() => void workspaces.refetch()} type="button">Could not load workspace. Try again.</button>;
  const workspace = workspaces.data.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center"><p className="text-sm font-medium">Workspace not found</p><Link className="mt-3 inline-block text-xs text-zinc-500 underline" href={dashboardRoutes.project(project.slug)}>Back to project</Link></div>;
  return <WorkspaceDetailContent project={project} workspace={workspace} />;
}

function WorkspaceDetailContent({ project, workspace }: { project: ManagedProject; workspace: ManagedWorkspace }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const runs = useQuery(runsQuery);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const runningCount = (runs.data ?? []).filter((run) =>
    run.projectId === project.id
    && run.workspace === workspace.name
    && run.status === "running"
  ).length;
  const removeWorkspace = useMutation({
    mutationFn: () => executeProjectRequest(project.id, {
      operation: "remove",
      workflow: workspace.workflow,
      workspace: workspace.name,
    }),
    onSuccess: (response) => {
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (runs = []) => [
        response.run,
        ...runs.filter((run) => run.id !== response.run.id),
      ]);
      router.push(dashboardRoutes.project(project.slug));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.runs }),
  });

  return (
    <div>
      <Link className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-950" href={dashboardRoutes.project(project.slug)}><ArrowLeft size={13} /> {project.name}</Link>
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-start">
          <div className="flex gap-3"><div className="grid size-10 place-items-center rounded-lg bg-zinc-100 text-zinc-500"><Box size={18} /></div><div><h2 className="text-lg font-semibold">{workspace.name}</h2><p className="mt-1 text-xs text-zinc-500">Workflow {workspace.workflow}</p></div></div>
          <Link className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium shadow-xs transition ${runningCount ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"}`} href={dashboardRoutes.workspaceRuns(project.slug, workspace.id)}>
            {runningCount ? <CircleDashed className="animate-spin" size={14} /> : <Activity size={14} />}
            {runningCount ? `${runningCount} running` : "View runs"}
          </Link>
        </div>
        <div className="grid border-t border-zinc-100 sm:grid-cols-3">
          <Metadata label="Created from" value={workspace.createdFrom.kind === "dashboard" ? "Stoke dashboard" : workspace.createdFrom.deviceName} icon={workspace.createdFrom.kind === "dashboard" ? LayoutDashboard : Laptop} />
          <Metadata label="Workspace ID" value={workspace.id.slice(0, 12)} />
          <Metadata label="Updated" value={new Date(workspace.updatedAt).toLocaleString()} />
        </div>
      </div>

      <WorkspaceOperations project={project} workspace={workspace} />

      <section className="mt-8 rounded-lg border border-red-200 bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-medium">Remove workspace</h2><p className="mt-1 text-xs text-zinc-500">Run the workflow’s remove handler and delete its managed state.</p></div><button className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${confirmRemove ? "border-red-600 bg-red-600 text-white" : "border-red-200 text-red-600 hover:bg-red-50"}`} disabled={removeWorkspace.isPending} onBlur={() => setConfirmRemove(false)} onClick={() => confirmRemove ? removeWorkspace.mutate() : setConfirmRemove(true)} type="button"><Trash2 size={13} /> {removeWorkspace.isPending ? "Removing…" : confirmRemove ? "Confirm remove" : "Remove workspace"}</button></div>{removeWorkspace.isError ? <p className="mt-3 text-xs text-red-600">{removeWorkspace.error.message}</p> : null}</section>
    </div>
  );
}

function Metadata({ icon: Icon, label, value }: { icon?: typeof Box; label: string; value: string }) { return <div className="border-t border-zinc-100 p-4 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0"><p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p><p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-zinc-700">{Icon ? <Icon size={12} /> : null}{value}</p></div>; }
function WorkspaceDetailSkeleton() { return <div className="space-y-4"><div className="h-4 w-24 animate-pulse rounded bg-zinc-200" /><div className="h-48 animate-pulse rounded-xl border border-zinc-200 bg-white" /><div className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-white" /></div>; }
