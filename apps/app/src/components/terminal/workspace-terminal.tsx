"use client";

import { CircleDashed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openWorkspaceTerminal } from "../../lib/api-client.ts";

export function WorkspaceTerminal({ projectId, sandbox }: {
  projectId: string;
  sandbox: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "failed">("connecting");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let terminal: import("@xterm/xterm").Terminal | undefined;
    let resizeObserver: ResizeObserver | undefined;
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
          theme: { background: "#09090b", foreground: "#e4e4e7", cursor: "#fafafa" },
        });
        terminal.open(container.current);
        terminalRef.current = terminal;
        resizeObserver = new ResizeObserver(([entry]) => {
          if (!entry || !terminal) return;
          const cols = Math.max(20, Math.floor((entry.contentRect.width - 24) / 8));
          const rows = Math.max(8, Math.floor((entry.contentRect.height - 24) / 17));
          terminal.resize(cols, rows);
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
        });
        resizeObserver.observe(container.current);

        const socketUrl = new URL(interactive.url);
        socketUrl.searchParams.set("token", interactive.token);
        socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";
        terminal.onData((data) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
        });
        socket.onopen = () => {
          socket?.send(JSON.stringify({
            type: "start",
            command: "bash",
            args: ["-l"],
            env: ["TERM=xterm-256color"],
            cols: terminal?.cols ?? 80,
            rows: terminal?.rows ?? 28,
          }));
          setStatus("connected");
          terminal?.focus();
        };
        socket.onmessage = async (event) => {
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data) as { type?: string; code?: number };
              if (message.type === "exit") terminal?.writeln(`\r\n[process exited ${message.code ?? 0}]`);
            } catch {
              terminal?.write(event.data);
            }
            return;
          }
          const bytes = event.data instanceof Blob
            ? new Uint8Array(await event.data.arrayBuffer())
            : new Uint8Array(event.data as ArrayBuffer);
          terminal?.write(bytes);
        };
        socket.onerror = () => {
          setStatus("failed");
          setError("The terminal connection failed.");
        };
      } catch (cause) {
        if (!disposed) {
          setStatus("failed");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      socket?.close();
      terminal?.dispose();
      terminalRef.current = null;
    };
  }, [projectId, sandbox]);

  return (
    <div className="relative min-h-0 flex-1 bg-zinc-950" onMouseDown={() => terminalRef.current?.focus()}>
      {status === "connecting" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-zinc-950 text-zinc-400">
          <div className="text-center"><CircleDashed className="mx-auto animate-spin text-violet-400" size={20} /><p className="mt-3 text-xs">Connecting to Sandbox…</p></div>
        </div>
      ) : null}
      {status === "failed" ? <div className="absolute inset-0 z-10 grid place-items-center bg-zinc-950 p-8 text-sm text-red-400">{error}</div> : null}
      <div className="absolute inset-0 p-3" ref={container} />
    </div>
  );
}
