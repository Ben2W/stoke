"use client";

import { CircleDashed, Terminal } from "lucide-react";
import { StokeLogo } from "../brand/stoke-logo.tsx";
import { WorkspaceTerminal } from "./workspace-terminal.tsx";

export function WorkspaceTerminalPage({ cwd, projectId, sandbox, title }: {
  cwd: string;
  projectId?: string;
  sandbox?: string;
  title: string;
}) {
  return (
    <main className="flex h-screen min-h-[32rem] flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <StokeLogo className="size-6 shrink-0 ring-1 ring-zinc-700" />
          <div className="min-w-0">
            <h1 className="truncate text-xs font-medium">{title}</h1>
            <p className="mt-0.5 truncate font-mono text-[9px] text-zinc-500">{sandbox ?? "Preparing workspace connection"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500"><Terminal size={11} /> usestoke.dev</div>
      </header>
      {projectId && sandbox ? (
        <WorkspaceTerminal cwd={cwd} projectId={projectId} sandbox={sandbox} />
      ) : (
        <div className="grid flex-1 place-items-center text-zinc-400">
          <div className="text-center"><CircleDashed className="mx-auto animate-spin text-violet-400" size={22} /><p className="mt-3 text-xs">Preparing SSH…</p></div>
        </div>
      )}
    </main>
  );
}
