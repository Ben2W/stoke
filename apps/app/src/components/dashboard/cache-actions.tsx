"use client";

import type { ManagedProject, ManagedRun, ManagedRunOperation } from "@usestoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleDashed, ListChecks, Play } from "lucide-react";
import { executeProject } from "../../lib/api-client.ts";
import { queryKeys } from "../../lib/queries.ts";

export function CacheActions({ activeRun, project }: { activeRun?: ManagedRun; project: ManagedProject }) {
  const queryClient = useQueryClient();
  const execution = useMutation({
    mutationFn: (operation: ManagedRunOperation) => executeProject(project.id, operation),
    onSuccess: (response) => {
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (current = []) => {
        const found = current.some((run) => run.id === response.run.id);
        return found
          ? current.map((run) => run.id === response.run.id ? response.run : run)
          : [response.run, ...current];
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCache(project.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
    },
  });

  if (project.source.kind !== "github") {
    return <p className="text-[11px] text-zinc-500">Connect a GitHub repository to plan or apply on the web.</p>;
  }

  const activeOperation = execution.isPending ? execution.variables : activeRun?.operation;
  const disabled = execution.isPending || Boolean(activeRun);
  return (
    <div>
      <div className="flex items-center gap-2">
        <ActionButton
          disabled={disabled}
          icon={ListChecks}
          label="Plan"
          loading={activeOperation === "plan"}
          onClick={() => execution.mutate("plan")}
          secondary
        />
        <ActionButton
          disabled={disabled}
          icon={Play}
          label="Apply"
          loading={activeOperation === "apply"}
          onClick={() => execution.mutate("apply")}
        />
      </div>
      {execution.isError ? <p className="mt-1.5 max-w-xs text-right text-[10px] text-red-600">{execution.error.message}</p> : null}
    </div>
  );
}

function ActionButton({
  disabled,
  icon: Icon,
  label,
  loading,
  onClick,
  secondary = false,
}: {
  disabled: boolean;
  icon: typeof Play;
  label: string;
  loading: boolean;
  onClick(): void;
  secondary?: boolean;
}) {
  return (
    <button
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-[11px] font-medium transition disabled:cursor-wait disabled:opacity-60 ${secondary ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50" : "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800"}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {loading ? <CircleDashed className="animate-spin" size={12} /> : <Icon size={12} />}
      {loading ? (label === "Plan" ? "Planning…" : "Applying…") : label}
    </button>
  );
}
