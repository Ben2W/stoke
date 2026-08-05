"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openWorkspaceTerminal } from "../../lib/api-client.ts";

export function WorkspaceTerminalDialog({ onClose, projectId, sandbox, title }: {
  onClose(): void;
  projectId: string;
  sandbox: string;
  title: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let terminal: import("@xterm/xterm").Terminal | undefined;
    void (async () => {
      try {
        const [{ Terminal }, interactive] = await Promise.all([
          import("@xterm/xterm"),
          openWorkspaceTerminal(projectId, sandbox),
        ]);
        if (disposed || !container.current) return;
        terminal = new Terminal({
          cursorBlink: true,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          rows: 28,
          theme: { background: "#09090b", foreground: "#e4e4e7", cursor: "#fafafa" },
        });
        terminal.open(container.current);
        const socketUrl = new URL(interactive.url);
        socketUrl.searchParams.set("token", interactive.token);
        socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";
        terminal.onData((data) => socket?.readyState === WebSocket.OPEN && socket.send(data));
        terminal.onResize(({ cols, rows }) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "resize", cols, rows })));
        socket.addEventListener("open", () => socket?.send(JSON.stringify({
          type: "start",
          command: "bash",
          args: ["-l"],
          env: ["TERM=xterm-256color"],
          cols: terminal?.cols ?? 80,
          rows: terminal?.rows ?? 28,
        })));
        socket.addEventListener("message", async (event) => {
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data) as { type?: string; code?: number };
              if (message.type === "exit") terminal?.writeln(`\r\n[process exited ${message.code ?? 0}]`);
            } catch { terminal?.write(event.data); }
            return;
          }
          const bytes = event.data instanceof Blob
            ? new Uint8Array(await event.data.arrayBuffer())
            : new Uint8Array(event.data as ArrayBuffer);
          terminal?.write(bytes);
        });
        socket.addEventListener("error", () => setError("The terminal connection failed."));
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      disposed = true;
      socket?.close();
      terminal?.dispose();
    };
  }, [projectId, sandbox]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/55 p-4 backdrop-blur-[2px]" role="presentation">
      <section aria-label={`${title} terminal`} aria-modal="true" className="w-full max-w-5xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl" role="dialog">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-zinc-200"><div><p className="text-xs font-medium">{title}</p><p className="mt-0.5 font-mono text-[10px] text-zinc-500">{sandbox}</p></div><button aria-label="Close terminal" className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-white" onClick={onClose} type="button"><X size={16} /></button></header>
        {error ? <div className="grid h-[28rem] place-items-center p-8 text-sm text-red-400">{error}</div> : <div className="h-[28rem] p-3" ref={container} />}
      </section>
    </div>
  );
}
