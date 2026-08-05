"use client";

import { Terminal } from "lucide-react";
import type { RunTaskOutput } from "./run-task-flow.ts";

export function TaskConsoleOutput({ empty, output }: { empty?: string; output: RunTaskOutput[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-inner">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
        <Terminal size={9} /> Output
      </div>
      <div className="max-h-56 overflow-auto px-3 py-2 font-mono text-[10px] leading-4">
        {output.length ? output.map((item) => (
          <pre className={`whitespace-pre-wrap break-words ${outputColor(item)}`} key={item.id}>{item.text.trimEnd()}</pre>
        )) : <p className="text-zinc-500">{empty ?? "Waiting for task output…"}</p>}
      </div>
    </div>
  );
}

function outputColor(output: RunTaskOutput): string {
  if (output.stream === "error" || output.stream === "stderr") return "text-red-300";
  if (output.stream === "warn") return "text-amber-300";
  if (output.stream === "debug" || output.kind === "detail") return "text-zinc-500";
  if (output.kind === "command" && output.text.startsWith("$ ")) return "text-cyan-300";
  return "text-zinc-300";
}
