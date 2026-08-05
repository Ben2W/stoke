import type { ManagedRun } from "@stoke/managed";
import type { RunTaskFlow } from "./run-task-flow.ts";
import { TaskConsoleOutput } from "./task-console-output.tsx";

export function CacheRunOutput({ flow, run }: { flow: RunTaskFlow; run: ManagedRun }) {
  const output = flow.tasks.flatMap((task) => task.output);
  const activeTask = flow.tasks.find((task) => task.status === "running");
  const cachedOnly = flow.tasks.length > 0 && flow.tasks.every((task) => task.status === "cached");
  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium text-zinc-700">{activeTask ? activeTask.nodePath : `${run.operation === "apply" ? "Apply" : "Plan"} output`}</p>
        <span className="text-[9px] text-zinc-400">Live from Vercel Sandbox</span>
      </div>
      <TaskConsoleOutput
        empty={cachedOnly ? "Cached tasks do not execute, so they do not emit console output." : "Waiting for task console output…"}
        output={output}
      />
    </div>
  );
}
