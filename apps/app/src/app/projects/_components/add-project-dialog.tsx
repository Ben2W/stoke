"use client";

import type { ManagedProject } from "@usestoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createGitHubProject } from "../../../lib/api-client.ts";
import { queryKeys } from "../../../lib/queries.ts";
import {
  EXAMPLE_PROJECT_URL,
  ExampleProjectOption,
  GitHubProjectOption,
  LocalProjectOption,
  hasExampleProject,
} from "./add-project-options.tsx";

export function AddProjectDialog({ open, onClose, onProjectAdded, projects }: {
  open: boolean;
  onClose(): void;
  onProjectAdded(project: ManagedProject): void;
  projects: ManagedProject[];
}) {
  if (!open) return null;
  return (
    <AddProjectDialogContent
      onClose={onClose}
      onProjectAdded={onProjectAdded}
      projects={projects}
    />
  );
}

function AddProjectDialogContent({ onClose, onProjectAdded, projects }: {
  onClose(): void;
  onProjectAdded(project: ManagedProject): void;
  projects: ManagedProject[];
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const addProject = useMutation({
    mutationFn: createGitHubProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      onClose();
      onProjectAdded(project);
    },
  });
  const exampleAdded = hasExampleProject(projects);
  const exampleRequest = addProject.variables?.url === EXAMPLE_PROJECT_URL;
  const addingExample = addProject.isPending && exampleRequest;
  const addingUrl = addProject.isPending && !exampleRequest;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !addProject.isPending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [addProject.isPending, onClose]);

  const error = addProject.error instanceof Error ? addProject.error.message : undefined;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-[2px]" onMouseDown={(event) => event.currentTarget === event.target && !addProject.isPending && onClose()} role="presentation">
      <section aria-labelledby="add-project-title" aria-modal="true" className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <header className="flex items-start justify-between border-b border-zinc-100 px-6 py-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight" id="add-project-title">Add a project</h2>
            <p className="mt-1 text-sm text-zinc-500">Try the example or connect your own repository.</p>
          </div>
          <button aria-label="Close dialog" className="grid size-8 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" disabled={addProject.isPending} onClick={onClose} type="button"><X size={17} /></button>
        </header>

        <div className="space-y-5 p-6">
          <ExampleProjectOption
            added={exampleAdded}
            busy={addProject.isPending}
            error={exampleRequest ? error : undefined}
            pending={addingExample}
            onAdd={() => addProject.mutate({ url: EXAMPLE_PROJECT_URL })}
          />
          <div className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400"><span className="h-px flex-1 bg-zinc-200" />Connect your repository<span className="h-px flex-1 bg-zinc-200" /></div>
          <GitHubProjectOption
            busy={addProject.isPending}
            error={!exampleRequest ? error : undefined}
            onChange={setUrl}
            onSubmit={() => addProject.mutate({ url })}
            pending={addingUrl}
            url={url}
          />
          <LocalProjectOption />
        </div>
      </section>
    </div>
  );
}
