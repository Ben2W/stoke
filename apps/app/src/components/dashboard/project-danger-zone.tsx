"use client";

import type { ManagedProject } from "@stoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteManagedProject } from "../../lib/api-client.ts";
import { queryKeys } from "../../lib/queries.ts";

export function ProjectDangerZone({
  project,
  onDeleted,
}: {
  project: ManagedProject;
  onDeleted(): void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const deletion = useMutation({
    mutationFn: () => deleteManagedProject(project.id),
    onSuccess: (deletedProject) => {
      queryClient.setQueryData<ManagedProject[]>(queryKeys.projects, (projects = []) =>
        projects.filter((candidate) => candidate.id !== deletedProject.id)
      );
      queryClient.removeQueries({ queryKey: ["projects", deletedProject.id] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.checkouts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      onDeleted();
    },
  });

  return (
    <section className="mt-8 rounded-lg border border-red-200 bg-white p-5" aria-labelledby="danger-zone-heading">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-sm font-medium text-zinc-900" id="danger-zone-heading">Delete project</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Remove {project.name} and its managed state from Stoke. Local files and the GitHub repository are not deleted.
          </p>
        </div>
        <button
          className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${confirming ? "border-red-600 bg-red-600 text-white hover:bg-red-700" : "border-red-200 bg-white text-red-600 hover:bg-red-50"}`}
          disabled={deletion.isPending}
          onBlur={() => setConfirming(false)}
          onClick={() => confirming ? deletion.mutate() : setConfirming(true)}
          type="button"
        >
          <Trash2 size={14} />
          {deletion.isPending ? "Deleting…" : confirming ? "Confirm delete" : "Delete project"}
        </button>
      </div>
      {deletion.isError ? <p className="mt-3 text-xs text-red-600" role="alert">{deletion.error.message}</p> : null}
    </section>
  );
}
