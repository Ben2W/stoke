"use client";

import type { ManagedProject, ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Box, ExternalLink, LayoutDashboard, Laptop, Play, TerminalSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import { executeProjectRequest } from "../../lib/api-client.ts";
import { projectWorkspacesQuery, queryKeys } from "../../lib/queries.ts";
import { WorkspaceTerminalDialog } from "./workspace-terminal-dialog.tsx";

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
  const [terminalOpen, setTerminalOpen] = useState(false);
  const sandbox = typeof workspace.ctx.sandbox === "string" ? workspace.ctx.sandbox : undefined;
  const url = typeof workspace.ctx.url === "string" && /^https?:\/\//.test(workspace.ctx.url) ? workspace.ctx.url : undefined;
  const execute = useMutation({
    mutationFn: (input: { operation: "remove" } | { operation: "run"; workspaceOperation: string }) => executeProjectRequest(project.id, input.operation === "remove"
      ? { operation: "remove", workflow: workspace.workflow, workspace: workspace.name }
      : { operation: "run", workflow: workspace.workflow, workspace: workspace.name, workspaceOperation: input.workspaceOperation, input: {} }),
    onSuccess: (response, input) => {
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (runs = []) => [response.run, ...runs.filter((run) => run.id !== response.run.id)]);
      if (input.operation === "remove") onBack();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
    },
  });
  return (
    <div>
      <button className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-950" onClick={onBack} type="button"><ArrowLeft size={13} /> {project.name}</button>
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-start">
          <div className="flex gap-3"><div className="grid size-10 place-items-center rounded-lg bg-zinc-100 text-zinc-500"><Box size={18} /></div><div><h2 className="text-lg font-semibold">{workspace.name}</h2><p className="mt-1 text-xs text-zinc-500">Workflow {workspace.workflow}</p></div></div>
          <div className="flex flex-wrap gap-2">
            {url ? <a className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs font-medium hover:bg-zinc-50" href={url} rel="noreferrer" target="_blank">Open environment <ExternalLink size={12} /></a> : null}
            {sandbox ? <button className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800" onClick={() => setTerminalOpen(true)} type="button"><TerminalSquare size={13} /> Terminal</button> : null}
          </div>
        </div>
        <div className="grid border-t border-zinc-100 sm:grid-cols-3">
          <Metadata label="Created from" value={workspace.createdFrom.kind === "dashboard" ? "Stoke dashboard" : workspace.createdFrom.deviceName} icon={workspace.createdFrom.kind === "dashboard" ? LayoutDashboard : Laptop} />
          <Metadata label="Workspace ID" value={workspace.id.slice(0, 12)} />
          <Metadata label="Updated" value={new Date(workspace.updatedAt).toLocaleString()} />
        </div>
      </div>

      <section className="mt-8" aria-labelledby="operations-heading"><h2 className="text-sm font-medium" id="operations-heading">Operations</h2><p className="mt-1 text-xs text-zinc-500">Actions exposed by this workspace’s Stoke workflow.</p>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {workspace.operations.length ? workspace.operations.map((operation, index) => {
            const isSsh = operation.requiredCapabilities.length === 1 && operation.requiredCapabilities[0]?.id === "ssh" && Boolean(sandbox);
            const unsupported = operation.requiredCapabilities.length > 0 && !isSsh;
            const needsInput = Array.isArray(operation.inputSchema?.required) && operation.inputSchema.required.length > 0;
            return <div className={`flex items-center justify-between gap-4 p-4 ${index ? "border-t border-zinc-100" : ""}`} key={operation.id}><div><p className="text-sm font-medium">{operation.title ?? operation.id}</p><p className="mt-1 text-xs text-zinc-500">{operation.description ?? operation.id}{unsupported ? ` · Requires ${operation.requiredCapabilities.map((item) => item.id).join(", ")}` : needsInput ? " · Requires input" : ""}</p></div><button className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-[11px] font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={execute.isPending || unsupported || needsInput} onClick={() => isSsh ? setTerminalOpen(true) : execute.mutate({ operation: "run", workspaceOperation: operation.id })} type="button">{isSsh ? <TerminalSquare size={12} /> : <Play size={12} />}{isSsh ? "Open terminal" : "Run"}</button></div>;
          }) : <p className="p-5 text-xs text-zinc-500">This workflow does not expose additional workspace operations.</p>}
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-red-200 bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-medium">Remove workspace</h2><p className="mt-1 text-xs text-zinc-500">Run the workflow’s remove handler and delete its managed state.</p></div><button className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${confirmRemove ? "border-red-600 bg-red-600 text-white" : "border-red-200 text-red-600 hover:bg-red-50"}`} disabled={execute.isPending} onBlur={() => setConfirmRemove(false)} onClick={() => confirmRemove ? execute.mutate({ operation: "remove" }) : setConfirmRemove(true)} type="button"><Trash2 size={13} /> {execute.isPending && execute.variables?.operation === "remove" ? "Removing…" : confirmRemove ? "Confirm remove" : "Remove workspace"}</button></div>{execute.isError ? <p className="mt-3 text-xs text-red-600">{execute.error.message}</p> : null}</section>
      {terminalOpen && sandbox ? <WorkspaceTerminalDialog onClose={() => setTerminalOpen(false)} projectId={project.id} sandbox={sandbox} title={workspace.name} /> : null}
    </div>
  );
}

function Metadata({ icon: Icon, label, value }: { icon?: typeof Box; label: string; value: string }) { return <div className="border-t border-zinc-100 p-4 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0"><p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p><p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-zinc-700">{Icon ? <Icon size={12} /> : null}{value}</p></div>; }
function WorkspaceDetailSkeleton() { return <div className="space-y-4"><div className="h-4 w-24 animate-pulse rounded bg-zinc-200" /><div className="h-48 animate-pulse rounded-xl border border-zinc-200 bg-white" /><div className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-white" /></div>; }
