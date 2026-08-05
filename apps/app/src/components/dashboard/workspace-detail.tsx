"use client";

import type { ManagedProject, ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Box, LayoutDashboard, Laptop, Trash2 } from "lucide-react";
import { useState } from "react";
import { executeProjectRequest } from "../../lib/api-client.ts";
import { projectWorkspacesQuery, queryKeys } from "../../lib/queries.ts";
import { WorkspaceOperations } from "./workspace-operations.tsx";
import { WorkspaceRunHistory } from "./workspace-run-history.tsx";

export function WorkspaceDetail({ onBack, project, workspaceId }: { onBack(): void; project: ManagedProject; workspaceId: string }) {
  const workspaces = useQuery(projectWorkspacesQuery(project.id));
  if (workspaces.isPending) return <WorkspaceDetailSkeleton />;
  if (workspaces.isError) return <button className="text-sm text-zinc-500" onClick={() => void workspaces.refetch()} type="button">Could not load workspace. Try again.</button>;
  const workspace = workspaces.data.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center"><p className="text-sm font-medium">Workspace not found</p><button className="mt-3 text-xs text-zinc-500 underline" onClick={onBack} type="button">Back to project</button></div>;
  return <WorkspaceDetailContent onBack={onBack} project={project} workspace={workspace} />;
}

function WorkspaceDetailContent({ onBack, project, workspace }: { onBack(): void; project: ManagedProject; workspace: ManagedWorkspace }) {
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
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
      queryClient.setQueryData<ManagedWorkspace[]>(
        queryKeys.projectWorkspaces(project.id),
        (workspaces = []) => workspaces.filter((candidate) => candidate.id !== workspace.id),
      );
      onBack();
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.runs }),
  });

  return (
    <div>
      <button className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-950" onClick={onBack} type="button"><ArrowLeft size={13} /> {project.name}</button>
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-start">
          <div className="flex gap-3"><div className="grid size-10 place-items-center rounded-lg bg-zinc-100 text-zinc-500"><Box size={18} /></div><div><h2 className="text-lg font-semibold">{workspace.name}</h2><p className="mt-1 text-xs text-zinc-500">Workflow {workspace.workflow}</p></div></div>
        </div>
        <div className="grid border-t border-zinc-100 sm:grid-cols-3">
          <Metadata label="Created from" value={workspace.createdFrom.kind === "dashboard" ? "Stoke dashboard" : workspace.createdFrom.deviceName} icon={workspace.createdFrom.kind === "dashboard" ? LayoutDashboard : Laptop} />
          <Metadata label="Workspace ID" value={workspace.id.slice(0, 12)} />
          <Metadata label="Updated" value={new Date(workspace.updatedAt).toLocaleString()} />
        </div>
      </div>

      <WorkspaceOperations project={project} workspace={workspace} />
      <WorkspaceRunHistory workspace={workspace} />

      <section className="mt-8 rounded-lg border border-red-200 bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-medium">Remove workspace</h2><p className="mt-1 text-xs text-zinc-500">Run the workflow’s remove handler and delete its managed state.</p></div><button className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${confirmRemove ? "border-red-600 bg-red-600 text-white" : "border-red-200 text-red-600 hover:bg-red-50"}`} disabled={removeWorkspace.isPending} onBlur={() => setConfirmRemove(false)} onClick={() => confirmRemove ? removeWorkspace.mutate() : setConfirmRemove(true)} type="button"><Trash2 size={13} /> {removeWorkspace.isPending ? "Removing…" : confirmRemove ? "Confirm remove" : "Remove workspace"}</button></div>{removeWorkspace.isError ? <p className="mt-3 text-xs text-red-600">{removeWorkspace.error.message}</p> : null}</section>
    </div>
  );
}

function Metadata({ icon: Icon, label, value }: { icon?: typeof Box; label: string; value: string }) { return <div className="border-t border-zinc-100 p-4 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0"><p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p><p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-zinc-700">{Icon ? <Icon size={12} /> : null}{value}</p></div>; }
function WorkspaceDetailSkeleton() { return <div className="space-y-4"><div className="h-4 w-24 animate-pulse rounded bg-zinc-200" /><div className="h-48 animate-pulse rounded-xl border border-zinc-200 bg-white" /><div className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-white" /></div>; }
