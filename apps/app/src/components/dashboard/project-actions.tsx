"use client";

import type { ManagedProject, ManagedRunOperation } from "@stoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleDashed, ListChecks, Play } from "lucide-react";
import { executeProject } from "../../lib/api-client.ts";
import { queryKeys } from "../../lib/queries.ts";

export function ProjectActions({ project }: { project: ManagedProject }) {
  const queryClient = useQueryClient();
  const execution = useMutation({
    mutationFn: (operation: ManagedRunOperation) => executeProject(project.id, operation),
    onMutate: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCache(project.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
    },
  });

  if (project.source.kind !== "github") {
    return <p className="text-xs text-zinc-500">Connect a GitHub repository to run this project on the web.</p>;
  }

  const activeOperation = execution.isPending ? execution.variables : undefined;
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex items-center gap-2">
        <ActionButton
          icon={ListChecks}
          label="Plan"
          loading={activeOperation === "plan"}
          disabled={execution.isPending}
          onClick={() => execution.mutate("plan")}
          secondary
        />
        <ActionButton
          icon={Play}
          label="Apply"
          loading={activeOperation === "apply"}
          disabled={execution.isPending}
          onClick={() => execution.mutate("apply")}
        />
      </div>
      {execution.isError ? <p className="max-w-sm text-right text-[11px] text-red-600">{execution.error.message}</p> : (
        <p className="text-[11px] text-zinc-400">Runs the GitHub source in a Vercel Sandbox</p>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  loading,
  disabled,
  onClick,
  secondary = false,
}: {
  icon: typeof Play;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick(): void;
  secondary?: boolean;
}) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${secondary ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50" : "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800"}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {loading ? <CircleDashed className="animate-spin" size={14} /> : <Icon size={14} />}
      {loading ? (label === "Plan" ? "Planning…" : "Applying…") : label}
    </button>
  );
}
