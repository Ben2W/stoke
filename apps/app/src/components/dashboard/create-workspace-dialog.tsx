"use client";

import type { ManagedProject, ManagedRun } from "@usestoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { executeProjectRequest } from "../../lib/api-client.ts";
import { queryKeys } from "../../lib/queries.ts";
import { generateWorkspaceName } from "../../lib/workspace-name.ts";

export function CreateWorkspaceDialog({ existingNames, open, onClose, onStarted, project }: {
  existingNames: Iterable<string>;
  open: boolean;
  onClose(): void;
  onStarted(input: { name: string; runId: string }): void;
  project: ManagedProject;
}) {
  if (!open) return null;

  return (
    <CreateWorkspaceDialogContent
      existingNames={existingNames}
      onClose={onClose}
      onStarted={onStarted}
      project={project}
    />
  );
}

function CreateWorkspaceDialogContent({ existingNames, onClose, onStarted, project }: {
  existingNames: Iterable<string>;
  onClose(): void;
  onStarted(input: { name: string; runId: string }): void;
  project: ManagedProject;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => generateWorkspaceName(existingNames));
  const creation = useMutation({
    mutationFn: () => executeProjectRequest(project.id, {
      operation: "create",
      workspace: name.trim(),
    }),
    onSuccess: (response) => {
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (runs = []) => [response.run, ...runs.filter((run) => run.id !== response.run.id)]);
      onStarted({ name: name.trim(), runId: response.run.id });
      setName("");
      onClose();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
    },
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !creation.isPending && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [creation.isPending, onClose]);
  const valid = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name.trim());
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-[2px]" onMouseDown={(event) => event.currentTarget === event.target && !creation.isPending && onClose()} role="presentation">
      <section aria-labelledby="create-workspace-title" aria-modal="true" className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-5">
          <div><h2 className="text-base font-semibold" id="create-workspace-title">Create workspace</h2><p className="mt-1 text-sm text-zinc-500">Provision it from the repository in Vercel Sandbox.</p></div>
          <button aria-label="Close" className="grid size-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100" disabled={creation.isPending} onClick={onClose} type="button"><X size={17} /></button>
        </div>
        <form className="p-6" onSubmit={(event) => { event.preventDefault(); if (valid) creation.mutate(); }}>
          <label className="block text-xs font-medium text-zinc-700">Workspace name<input autoFocus className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100" onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))} value={name} /></label>
          {name && !valid ? <p className="text-xs text-amber-700">Use lowercase letters, numbers, and hyphens.</p> : null}
          {creation.isError ? <p className="text-xs text-red-600" role="alert">{creation.error.message}</p> : null}
          <button className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 text-sm font-medium text-white disabled:opacity-50" disabled={!valid || creation.isPending} type="submit">{creation.isPending ? <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Check size={15} />}{creation.isPending ? "Starting…" : "Create workspace"}</button>
        </form>
        <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-6 py-4 text-xs text-zinc-500"><Box size={14} /> Creation continues in the background and appears here when ready.</div>
      </section>
    </div>
  );
}
