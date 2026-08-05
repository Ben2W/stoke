"use client";

import type { ManagedProject } from "@stoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, GitBranch, Laptop, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createGitHubProject } from "../../lib/api-client.ts";
import { queryKeys } from "../../lib/queries.ts";

export function AddProjectDialog({
  open,
  onClose,
  onProjectAdded,
}: {
  open: boolean;
  onClose(): void;
  onProjectAdded(project: ManagedProject): void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const addProject = useMutation({
    mutationFn: createGitHubProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      setUrl("");
      onClose();
      onProjectAdded(project);
    },
  });

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !addProject.isPending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [addProject.isPending, onClose, open]);

  if (!open) return null;
  const error = addProject.error instanceof Error ? addProject.error.message : undefined;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !addProject.isPending) onClose();
    }}>
      <section aria-labelledby="add-project-title" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight" id="add-project-title">Add a project</h2>
            <p className="mt-1 text-sm text-zinc-500">Connect a GitHub repository to Stoke.</p>
          </div>
          <button aria-label="Close dialog" className="grid size-8 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" disabled={addProject.isPending} onClick={onClose} type="button"><X size={17} /></button>
        </div>

        <form className="p-6" onSubmit={(event) => {
          event.preventDefault();
          addProject.mutate({ url });
        }}>
          <label className="text-xs font-medium text-zinc-700" htmlFor="github-repository-url">GitHub repository URL</label>
          <div className="mt-2 flex h-11 items-center gap-2.5 rounded-md border border-zinc-300 px-3 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-100">
            <GitBranch className="shrink-0 text-zinc-400" size={16} />
            <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" id="github-repository-url" onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" spellCheck={false} type="url" value={url} />
          </div>
          {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
          <button className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50" disabled={!url.trim() || addProject.isPending} type="submit">
            {addProject.isPending ? <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Check size={15} />}
            {addProject.isPending ? "Connecting…" : "Connect repository"}
          </button>
        </form>

        <div className="border-t border-zinc-100 bg-zinc-50/70 px-6 py-5">
          <div className="flex gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-500"><Laptop size={15} /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-800">Connecting a local checkout?</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Run this from your terminal so Stoke can associate the path with this machine.</p>
              <code className="mt-2 block overflow-x-auto rounded-md bg-zinc-950 px-3 py-2 text-[11px] text-zinc-100">stoke add /path/to/project</code>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
