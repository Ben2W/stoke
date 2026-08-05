"use client";

import type { ManagedRun } from "@usestoke/managed";
import { Check, CircleDashed, Cloud, RotateCcw, X } from "lucide-react";
import type { RunTask, RunTaskFlow, RunTaskStatus } from "./run-task-flow.ts";
import { TaskConsoleOutput } from "./task-console-output.tsx";

export function RunTaskFlowView({ flow, run }: { flow: RunTaskFlow; run: ManagedRun }) {
  const terminal = run.status !== "running";
  const taskOutputCount = flow.tasks.reduce((count, task) => count + task.output.length, 0) + flow.workflowOutput.length;

  return (
    <div className="space-y-5">
      {flow.setup ? <SetupRow status={flow.setup.status} /> : null}

      <section>
        <div className="flex items-center gap-3">
          <FlowIcon status={workflowStatus(run.status)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="truncate text-xs font-semibold text-zinc-900">
                {operationTitle(run.operation)} {run.workflow}
              </h3>
              <span className="text-[10px] text-zinc-400">{flowSummary(flow, run)}</span>
            </div>
          </div>
        </div>

        <div className="ml-[5px] mt-2 border-l border-zinc-200 pl-6">
          {flow.tasks.length ? (
            <div className="space-y-3">
              {flow.tasks.map((task) => <TaskRow key={task.nodePath} task={task} />)}
            </div>
          ) : run.status === "running" ? (
            <div className="flex items-center gap-2 py-1 text-[11px] text-zinc-500">
              <CircleDashed className="animate-spin text-blue-500" size={11} /> Discovering workflow…
            </div>
          ) : (
            <p className="py-1 text-[11px] text-zinc-500">No tasks were needed.</p>
          )}

          {flow.workflowOutput.length ? <div className="mt-2"><TaskConsoleOutput output={flow.workflowOutput} /></div> : null}

          {terminal && flow.tasks.length > 0 && taskOutputCount === 0 ? (
            <p className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-[10px] leading-4 text-zinc-500">
              {run.operation === "plan"
                ? "Plan evaluates task fingerprints without running task code, so it does not produce task output."
                : flow.cachedTaskCount === flow.tasks.length
                ? `No task output — all ${flow.tasks.length} ${noun("task", flow.tasks.length)} came from cache, so task code did not run.`
                : "No task output was emitted. Add console.log inside a task to stream its output here and in the CLI."}
            </p>
          ) : null}

          {(run.status === "failed" || run.status === "orphaned") && run.error ? (
            <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-700">{run.error}</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SetupRow({ status }: { status: "completed" | "failed" | "running" }) {
  return (
    <div className="flex items-center gap-3">
      {status === "running"
        ? <CircleDashed className="shrink-0 animate-spin text-violet-500" size={12} />
        : status === "failed"
          ? <X className="shrink-0 text-red-600" size={12} />
          : <Cloud className="shrink-0 text-violet-500" size={12} />}
      <p className="text-xs font-medium text-zinc-700">Setting up</p>
      <span className="ml-auto text-[10px] capitalize text-zinc-400">{status}</span>
    </div>
  );
}

function TaskRow({ task }: { task: RunTask }) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <FlowIcon status={task.status} />
        <p className={`min-w-0 flex-1 truncate text-xs ${task.status === "running" ? "font-medium text-zinc-900" : task.status === "failed" ? "text-red-700" : "text-zinc-700"}`}>
          {task.nodePath}
        </p>
        {task.status === "cached" ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-zinc-400"><RotateCcw size={9} /> cached</span>
        ) : task.runId ? (
          <code className="shrink-0 font-mono text-[9px] text-zinc-400">{task.runId.slice(0, 8)}</code>
        ) : task.status === "running" ? (
          <span className="shrink-0 text-[10px] text-blue-600">running</span>
        ) : null}
      </div>
      {task.output.length ? <div className="mt-2"><TaskConsoleOutput output={task.output} /></div> : null}
    </div>
  );
}

function FlowIcon({ status }: { status: RunTaskStatus }) {
  if (status === "running") return <CircleDashed className="shrink-0 animate-spin text-blue-600" size={12} />;
  if (status === "failed") return <X className="shrink-0 text-red-600" size={12} />;
  if (status === "cached") return <Check className="shrink-0 text-zinc-400" size={12} />;
  if (status === "pending") return <span className="size-3 shrink-0 rounded-full border border-amber-400 bg-amber-50" />;
  return <Check className="shrink-0 text-emerald-600" size={12} />;
}

function workflowStatus(status: ManagedRun["status"]): RunTaskStatus {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  return "failed";
}

function flowSummary(flow: RunTaskFlow, run: ManagedRun): string {
  if (run.status === "running") return `${flow.completedTaskCount}/${run.nodeCount ?? flow.tasks.length} complete`;
  if (flow.tasks.length === 0) return run.status === "completed" ? "complete" : "failed";
  if (run.operation === "plan") return `${flow.tasks.length} ${noun("task", flow.tasks.length)} planned`;
  if (flow.cachedTaskCount === flow.tasks.length) return `${flow.tasks.length}/${flow.tasks.length} cached`;
  if (flow.cachedTaskCount > 0) return `${flow.cachedTaskCount}/${flow.tasks.length} cached`;
  return `${flow.completedTaskCount} ${noun("task", flow.completedTaskCount)}`;
}

function noun(singular: string, count: number): string {
  return count === 1 ? singular : `${singular}s`;
}

function operationTitle(operation: ManagedRun["operation"]): string {
  if (operation === "plan") return "Plan";
  if (operation === "apply") return "Apply";
  if (operation === "create") return "Create workspace";
  if (operation === "remove") return "Remove workspace";
  return "Workspace operation";
}
