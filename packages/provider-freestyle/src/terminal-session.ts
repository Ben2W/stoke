import type { ServerWebSocket, Subprocess } from "bun";
import type { ProviderInteractionSession } from "@rigkit/engine";

export type FreestyleTerminalSessionRequest = {
  title: string;
  command: string;
  displayCommand?: string;
  startupInput?: string;
  remoteCommand?: string;
  canFinishWhileRunning?: boolean;
  instructions?: string;
  nodePath?: string;
};

export type FreestyleTerminalSessionResult = {
  finished: true;
};

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "finish" }
  | { type: "resize"; cols: number; rows: number };

type ServerMessage =
  | { type: "output"; data: string }
  | { type: "status"; status: string; exitCode?: number; canFinish?: boolean };

type SocketData = {
  token: string;
};

export function createFreestyleTerminalSession(
  request: FreestyleTerminalSessionRequest,
): ProviderInteractionSession<FreestyleTerminalSessionResult> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  let stopped = false;
  let processExitCode: number | undefined;
  let settled = false;
  let remoteCommandStarted = false;
  let terminalCols = 100;
  let terminalRows = 28;
  let terminalQueryBuffer = "";
  let proc: Subprocess<"pipe", "pipe", "pipe"> | undefined;
  let stdin: { write(data: Uint8Array): unknown; flush?(): unknown } | undefined;
  let complete!: (result: FreestyleTerminalSessionResult) => void;
  let fail!: (error: Error) => void;
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const outputBuffer: string[] = [];
  const startupCommand = request.startupInput ?? request.remoteCommand;
  const startupInput = startupCommand ? ensureTrailingNewline(startupCommand) : undefined;
  const displayCommand = request.displayCommand ?? request.remoteCommand ?? request.command;
  const canFinishWhileRunning = canFinishWhileProcessRuns(request, startupInput);

  const completed = new Promise<FreestyleTerminalSessionResult>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });

  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(httpRequest, server) {
      const url = new URL(httpRequest.url);

      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      if (url.searchParams.get("token") !== token) {
        return new Response("Not found", { status: 404 });
      }

      if (url.pathname === "/terminal" && server.upgrade(httpRequest, { data: { token } })) {
        return;
      }

      if (url.pathname === "/" && httpRequest.method === "GET") {
        return htmlResponse(renderInteractionPage(request, { startupInput }));
      }

      if (url.pathname === "/complete" && httpRequest.method === "POST") {
        requestFinish();
        return htmlResponse(renderInteractionPage(request, { completed: true }));
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        for (const chunk of outputBuffer) send(ws, { type: "output", data: chunk });
        sendStatus(ws);
        startProcess();
      },
      message(_ws, raw) {
        const message = parseClientMessage(raw);
        if (!message) return;
        if (message.type === "input") {
          writeInput(message.data);
          return;
        }
        if (message.type === "resize") {
          terminalCols = message.cols;
          terminalRows = message.rows;
          return;
        }
        requestFinish();
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
  });

  return {
    id,
    title: request.title,
    url: `http://127.0.0.1:${server.port}/?token=${encodeURIComponent(token)}`,
    instructions: request.instructions,
    completed,
    stop: () => {
      if (stopped) return;
      stopped = true;
      proc?.kill();
      server.stop(true);
    },
  };

  function startProcess(): void {
    if (proc || processExitCode !== undefined) return;

    broadcast({
      type: "status",
      status: "Connected",
      canFinish: canFinishWhileRunning,
    });

    proc = Bun.spawn(["sh", "-lc", `exec ${request.command}`], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    stdin = proc.stdin;

    pipeOutput(proc.stdout);
    pipeOutput(proc.stderr);

    proc.exited.then((code) => {
      processExitCode = code;
      stdin = undefined;
      appendOutput(`\r\n[shell exited ${code}]\r\n`);
      if (settled || stopped) return;
      if (code === 0) {
        broadcast({ type: "status", status: "Shell exited", exitCode: code, canFinish: true });
      } else {
        const error = new Error(`Interactive command "${request.title}" exited ${code}`);
        broadcast({ type: "status", status: error.message, exitCode: code, canFinish: false });
        fail(error);
      }
    }).catch((error) => {
      if (settled || stopped) return;
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async function pipeOutput(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text) handleProcessOutput(text);
      }
      const rest = decoder.decode();
      if (rest) handleProcessOutput(rest);
    } catch {
      // Process shutdown closes streams underneath us.
    }
  }

  function handleProcessOutput(data: string): void {
    appendOutput(data);
    respondToTerminalQueries(data);
  }

  function appendOutput(data: string): void {
    outputBuffer.push(data);
    while (outputBuffer.join("").length > 200_000) outputBuffer.shift();
    broadcast({ type: "output", data });
  }

  function writeInput(data: string): void {
    if (isCursorPositionReport(data)) return;

    if (startupInput && data === startupInput) {
      if (remoteCommandStarted) return;
      remoteCommandStarted = true;
      broadcast({
        type: "status",
        status: `Running ${displayCommand}`,
        canFinish: true,
      });
    }

    writeProcessInput(data);
  }

  function writeProcessInput(data: string): void {
    try {
      stdin?.write(new TextEncoder().encode(data));
      stdin?.flush?.();
    } catch {
      // The process may have exited between the browser input event and this write.
    }
  }

  function respondToTerminalQueries(data: string): void {
    terminalQueryBuffer += data;

    while (true) {
      const match = /\x1b\[(\??)6n/.exec(terminalQueryBuffer);
      if (!match) break;

      const prefix = match[1] ?? "";
      writeProcessInput(`\x1b[${prefix}${terminalRows};${terminalCols}R`);
      terminalQueryBuffer = terminalQueryBuffer.slice(match.index + match[0].length);
    }

    if (terminalQueryBuffer.length > 16) {
      terminalQueryBuffer = terminalQueryBuffer.slice(-16);
    }
  }

  function requestFinish(): void {
    if (settled) return;
    settled = true;
    broadcast({ type: "status", status: "Done. You can close this page now.", canFinish: false });
    complete({ finished: true });
  }

  function sendStatus(ws: ServerWebSocket<SocketData>): void {
    if (settled) {
      send(ws, { type: "status", status: "Done. You can close this page now.", canFinish: false });
      return;
    }
    if (processExitCode !== undefined) {
      send(ws, {
        type: "status",
        status: processExitCode === 0 ? "Shell exited" : `Shell exited ${processExitCode}`,
        exitCode: processExitCode,
        canFinish: processExitCode === 0,
      });
      return;
    }
    if (remoteCommandStarted) {
      send(ws, { type: "status", status: `Running ${displayCommand}`, canFinish: true });
      return;
    }
    send(ws, { type: "status", status: proc ? "Connected" : "Starting", canFinish: canFinishWhileRunning });
  }

  function broadcast(message: ServerMessage): void {
    for (const socket of sockets) send(socket, message);
  }
}

function parseClientMessage(raw: string | Buffer): ClientMessage | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const value = JSON.parse(raw) as ClientMessage;
    if (value.type === "finish") return value;
    if (value.type === "input" && typeof value.data === "string") return value;
    if (
      value.type === "resize" &&
      Number.isInteger(value.cols) &&
      Number.isInteger(value.rows) &&
      value.cols > 0 &&
      value.rows > 0
    ) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isCursorPositionReport(data: string): boolean {
  return /^\x1b\[\??\d+;\d+R$/.test(data);
}

function send(ws: ServerWebSocket<SocketData>, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://esm.sh",
        "style-src 'unsafe-inline'",
        "connect-src 'self' ws: wss: https://esm.sh",
        "form-action 'self'",
      ].join("; "),
    },
  });
}

function renderInteractionPage(
  request: FreestyleTerminalSessionRequest,
  options: { completed?: boolean; startupInput?: string } = {},
): string {
  const completed = options.completed ?? false;
  const command = request.displayCommand ?? request.remoteCommand ?? request.command;
  const node = request.nodePath ?? "provider";
  const instructions = request.instructions ?? "";

  const escapedDocTitle = escapeHtml(completed ? "Interactive task completed" : request.title);
  const escapedLabel = escapeHtml(request.title);
  const escapedCommand = escapeHtml(command);
  const escapedInstructions = instructions ? escapeHtml(instructions) : "";

  const titleLit = javaScriptLiteral(request.title);
  const instructionsLit = javaScriptLiteral(instructions);
  const commandLit = javaScriptLiteral(command);
  const nodeLit = javaScriptLiteral(node);
  const startupInputLiteral = javaScriptLiteral(options.startupInput ?? null);
  const canFinishWhileRunningLiteral = javaScriptLiteral(canFinishWhileProcessRuns(request, options.startupInput));
  const initialCompletedLiteral = completed ? "true" : "false";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedDocTitle}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg-0: #07070a;
      --bg-1: #0c0c11;
      --bg-2: #111118;
      --bg-3: #16161f;
      --border: #1f1f2a;
      --border-strong: #2a2a38;
      --text: #f5f5f7;
      --text-muted: #9a9aa8;
      --text-dim: #6c6c7a;
      --accent: #ff5a1f;
      --accent-soft: #ffb892;
      --accent-glow: rgba(255, 90, 31, 0.45);
      --ok: #34d399;
      --warn: #facc15;
      --err: #f87171;
      --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      --sans: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-family: var(--sans);
      color: var(--text);
      background: var(--bg-0);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      background:
        radial-gradient(circle at 10% -10%, rgba(255, 90, 31, 0.10), transparent 40%),
        radial-gradient(circle at 95% 110%, rgba(255, 90, 31, 0.06), transparent 50%),
        var(--bg-0);
    }
    #app {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
    }
    .noscript-fallback {
      padding: 32px;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
      max-width: 640px;
      margin: 0 auto;
    }
    .app-header {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 16px;
      padding: 14px 22px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, var(--bg-3), var(--bg-2));
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      letter-spacing: -0.01em;
    }
    .brand-mark {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      background: radial-gradient(circle at 30% 30%, #ffb892, #ff5a1f 65%, #d63d00);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset, 0 4px 14px var(--accent-glow);
      color: #1a0900;
      font-weight: 800;
      font-size: 14px;
      line-height: 1;
    }
    .brand-wordmark { color: var(--text); font-weight: 600; }
    .brand-divider { width: 1px; height: 14px; background: var(--border-strong); margin: 0 4px; }
    .brand-node { color: var(--text-muted); font-family: var(--mono); font-size: 12px; font-weight: 500; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 11px;
      border-radius: 999px;
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.02);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      max-width: 380px;
      min-width: 0;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--text-dim); flex: 0 0 auto; }
    .status-pill[data-state="working"] .status-dot { background: var(--accent); animation: pulse 1.6s ease-out infinite; }
    .status-pill[data-state="ready"] .status-dot { background: var(--ok); }
    .status-pill[data-state="done"] .status-dot { background: var(--ok); }
    .status-pill[data-state="error"] .status-dot { background: var(--err); }
    .status-pill .status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 var(--accent-glow); }
      70% { box-shadow: 0 0 0 6px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(340px, 460px) minmax(0, 1fr);
      gap: 22px;
      padding: 22px;
      min-height: 0;
      height: 100%;
    }
    .instructions-pane {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
      padding: 24px 22px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 20px 60px rgba(0, 0, 0, 0.4);
      overflow: auto;
      user-select: text;
    }
    .eyebrow {
      margin: 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .eyebrow::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent-glow);
    }
    .task-title {
      margin: 0;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: var(--text);
    }
    .instruction-text {
      margin: 0;
      white-space: pre-wrap;
      color: #d4d4dc;
      font-size: 14px;
      line-height: 1.55;
    }
    .instruction-steps {
      margin: 0;
      padding: 0;
      list-style: none;
      counter-reset: step;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .instruction-steps li {
      counter-increment: step;
      position: relative;
      padding: 11px 14px 11px 42px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid var(--border);
      color: #d4d4dc;
      font-size: 13.5px;
      line-height: 1.5;
    }
    .instruction-steps li::before {
      content: counter(step);
      position: absolute;
      left: 12px;
      top: 11px;
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: rgba(255, 90, 31, 0.16);
      border: 1px solid rgba(255, 90, 31, 0.42);
      color: var(--accent-soft);
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 600;
    }
    .command-block {
      margin: 0;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--border-strong);
      background: rgba(0, 0, 0, 0.4);
    }
    .command-label {
      margin: 0 0 6px;
      color: var(--text-dim);
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 600;
    }
    .command-code {
      margin: 0;
      font-family: var(--mono);
      font-size: 13px;
      color: var(--accent-soft);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .command-prompt { color: var(--text-dim); font-weight: 600; user-select: none; }
    .instructions-cta {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .primary-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 13px 18px;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.005em;
      cursor: pointer;
      color: #1a0900;
      background: linear-gradient(180deg, #ff7a45, #ff5a1f);
      box-shadow:
        0 0 0 1px rgba(255, 90, 31, 0.5) inset,
        0 1px 0 rgba(255, 255, 255, 0.25) inset,
        0 8px 22px rgba(255, 90, 31, 0.32);
      transition: filter 0.18s ease, box-shadow 0.18s ease;
    }
    .primary-button:hover:not(:disabled) {
      filter: brightness(1.06);
      box-shadow:
        0 0 0 1px rgba(255, 90, 31, 0.6) inset,
        0 1px 0 rgba(255, 255, 255, 0.3) inset,
        0 12px 30px rgba(255, 90, 31, 0.45);
    }
    .primary-button:disabled {
      cursor: not-allowed;
      color: var(--text-dim);
      background: var(--bg-2);
      box-shadow: 0 0 0 1px var(--border-strong) inset;
    }
    .primary-button .check { width: 16px; height: 16px; display: inline-grid; place-items: center; }
    .primary-button .check svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .cta-hint {
      margin: 0;
      color: var(--text-dim);
      font-size: 12px;
      line-height: 1.45;
      text-align: center;
    }
    .right-pane {
      position: relative;
      min-width: 0;
      min-height: 0;
    }
    .terminal-window {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.04) inset,
        0 20px 60px rgba(0, 0, 0, 0.45);
    }
    .term-titlebar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-3);
    }
    .lights { display: flex; gap: 7px; align-items: center; }
    .light {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .light.red { background: #ff5f57; }
    .light.yellow { background: #febc2e; }
    .light.green { background: #28c840; }
    .term-titlebar-label {
      color: var(--text-muted);
      font-family: var(--mono);
      font-size: 12px;
    }
    .terminal-shell {
      position: relative;
      min-height: 0;
      height: 100%;
      background: var(--bg-1);
      overflow: hidden;
      user-select: text;
    }
    .term-host {
      position: absolute;
      inset: 0;
      user-select: text;
      --term-bg: #0c0c11;
      --term-fg: #e8e8ee;
      --term-cursor: #ff5a1f;
      --term-font-family: var(--mono);
      --term-font-size: 13px;
      --term-row-height: 17px;
      --term-color-0: #1a1a22;
      --term-color-1: #ff6b6b;
      --term-color-2: #34d399;
      --term-color-3: #facc15;
      --term-color-4: #60a5fa;
      --term-color-5: #c084fc;
      --term-color-6: #5eead4;
      --term-color-7: #e5e7eb;
      --term-color-8: #6b7280;
      --term-color-9: #ff8a8a;
      --term-color-10: #6ee7b7;
      --term-color-11: #fde047;
      --term-color-12: #93c5fd;
      --term-color-13: #d8b4fe;
      --term-color-14: #99f6e4;
      --term-color-15: #ffffff;
    }
    .term-host:not(.ready) { visibility: hidden; }
    .term-fallback {
      position: absolute;
      inset: 0;
      z-index: 1;
      margin: 0;
      padding: 16px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--bg-1);
      color: #e5e7eb;
      user-select: text;
      font-family: var(--mono);
      font-size: 13px;
      line-height: 1.4;
    }
    .term-fallback.hidden { display: none; }
    .wterm {
      position: relative;
      background: var(--term-bg);
      color: var(--term-fg);
      font-family: var(--term-font-family);
      font-size: var(--term-font-size);
      line-height: 1.2;
      padding: 14px 16px;
      outline: none;
      overflow: auto;
      user-select: text;
    }
    .term-grid { display: block; white-space: pre; contain: layout paint style; user-select: text; }
    .term-row {
      display: block;
      height: var(--term-row-height);
      line-height: var(--term-row-height);
      user-select: text;
    }
    .term-row > span {
      display: inline-block;
      height: var(--term-row-height);
      vertical-align: top;
      user-select: text;
    }
    .term-block { width: 1ch; overflow: hidden; }
    .term-cursor { outline: 1px solid var(--term-cursor); outline-offset: -1px; }
    .wterm.focused .term-cursor { background: var(--term-cursor); color: var(--bg-1); outline: none; }
    .success-pane {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .success-card {
      width: min(440px, 100%);
      padding: 32px 28px 28px;
      border-radius: 16px;
      border: 1px solid var(--border-strong);
      background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.05) inset,
        0 30px 80px rgba(0, 0, 0, 0.55),
        0 0 60px rgba(52, 211, 153, 0.08);
      text-align: center;
    }
    .success-icon {
      width: 72px;
      height: 72px;
      margin: 0 auto 18px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: radial-gradient(circle at 30% 30%, #6ee7b7, #10b981 70%);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.12) inset,
        0 0 0 8px rgba(16, 185, 129, 0.08),
        0 14px 36px rgba(16, 185, 129, 0.32);
      color: #052e1d;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
      fill: none;
      stroke: currentColor;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .success-title {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.015em;
      color: var(--text);
    }
    .success-message {
      margin: 0 0 18px;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .success-meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 11px;
      border-radius: 999px;
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.02);
      color: var(--text-dim);
      font-family: var(--mono);
      font-size: 11.5px;
    }
    .success-meta-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--ok);
      box-shadow: 0 0 8px rgba(52, 211, 153, 0.6);
    }
    @media (max-width: 880px) {
      body { overflow: auto; }
      #app { height: auto; min-height: 100vh; }
      .workspace { grid-template-columns: 1fr; padding: 16px; gap: 16px; }
      .right-pane { height: min(640px, 70vh); }
    }
    @media (max-width: 540px) {
      .app-header { padding: 12px 14px; }
      .brand-wordmark, .brand-divider, .brand-node { display: none; }
      .status-pill { max-width: 200px; }
    }
  </style>
</head>
<body>
  <div id="app">
    <noscript>
      <div class="noscript-fallback">
        <h1>${escapedLabel}</h1>
        ${escapedInstructions ? `<p>${escapedInstructions}</p>` : ""}
        <pre>$ ${escapedCommand}</pre>
        <p>This interactive task requires JavaScript to run a terminal in your browser.</p>
      </div>
    </noscript>
  </div>
  <script type="module">
    import * as React from "https://esm.sh/react@18.3.1";
    import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
    import { motion, AnimatePresence } from "https://esm.sh/framer-motion@11.11.17?deps=react@18.3.1,react-dom@18.3.1";

    const h = React.createElement;
    const F = React.Fragment;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    const TASK_TITLE = ${titleLit};
    const TASK_INSTRUCTIONS = ${instructionsLit};
    const TASK_COMMAND = ${commandLit};
    const NODE_PATH = ${nodeLit};
    const startupInput = ${startupInputLiteral};
    const canFinishWhileRunning = ${canFinishWhileRunningLiteral};
    const INITIAL_COMPLETED = ${initialCompletedLiteral};
    const token = new URLSearchParams(location.search).get("token") || "";

    let terminalEl = null;
    let term;
    let termReady = false;
    let socket;
    let startupSent = false;
    let startupIdleTimer;
    let startupMaxTimer;
    const outputBacklog = [];
    const listeners = {
      onStatus: null,
      onOutput: null,
      onClose: null,
    };

    function sendTerminalInput(data) {
      if (!data || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "input", data }));
    }

    function sendStartupInput() {
      if (!startupInput || startupSent || !socket || socket.readyState !== WebSocket.OPEN) return;
      startupSent = true;
      clearTimeout(startupIdleTimer);
      clearTimeout(startupMaxTimer);
      sendTerminalInput(startupInput);
    }

    function scheduleStartupInput(delay) {
      if (!startupInput || startupSent || !socket || socket.readyState !== WebSocket.OPEN) return;
      clearTimeout(startupIdleTimer);
      startupIdleTimer = setTimeout(sendStartupInput, delay || 350);
      startupMaxTimer = startupMaxTimer || setTimeout(sendStartupInput, 1500);
    }

    function isTextEditingTarget(target) {
      if (!(target instanceof Element)) return false;
      if (terminalEl && terminalEl.contains(target)) return false;
      return Boolean(target.closest("textarea, input, select, button, [contenteditable=''], [contenteditable='true']"));
    }

    function keyEventToTerminalInput(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "c") {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return null;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "v") return null;
      if (event.metaKey && !event.ctrlKey) return null;

      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key.length === 1) {
          const code = event.key.toLowerCase().charCodeAt(0);
          if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
        }
        if (event.key === "[") return "\\x1b";
        if (event.key === "\\\\") return "\\x1c";
        if (event.key === "]") return "\\x1d";
        if (event.key === "^") return "\\x1e";
        if (event.key === "_") return "\\x1f";
      }

      if (event.key === "Enter" && event.shiftKey) return "\\x1b[13;2u";
      if (event.key === "Tab" && event.shiftKey) return "\\x1b[Z";

      const fixed = {
        Enter: "\\r",
        Backspace: "\\x7f",
        Tab: "\\t",
        Escape: "\\x1b",
        Insert: "\\x1b[2~",
        Delete: "\\x1b[3~",
        PageUp: "\\x1b[5~",
        PageDown: "\\x1b[6~",
        F1: "\\x1bOP",
        F2: "\\x1bOQ",
        F3: "\\x1bOR",
        F4: "\\x1bOS",
        F5: "\\x1b[15~",
        F6: "\\x1b[17~",
        F7: "\\x1b[18~",
        F8: "\\x1b[19~",
        F9: "\\x1b[20~",
        F10: "\\x1b[21~",
        F11: "\\x1b[23~",
        F12: "\\x1b[24~",
      };
      if (fixed[event.key]) return event.altKey ? "\\x1b" + fixed[event.key] : fixed[event.key];

      const navigation = {
        ArrowUp: "\\x1b[A",
        ArrowDown: "\\x1b[B",
        ArrowRight: "\\x1b[C",
        ArrowLeft: "\\x1b[D",
        Home: "\\x1b[H",
        End: "\\x1b[F",
      };
      if (navigation[event.key]) return event.altKey ? "\\x1b" + navigation[event.key] : navigation[event.key];

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        return event.altKey ? "\\x1b" + event.key : event.key;
      }

      return null;
    }

    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      const data = keyEventToTerminalInput(event);
      if (!data) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      term?.focus();
      sendTerminalInput(data);
    }, { capture: true });

    function setupSocket() {
      const terminalUrl = new URL("/terminal", location.href);
      terminalUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      terminalUrl.searchParams.set("token", token);
      socket = new WebSocket(terminalUrl);
      socket.addEventListener("open", () => {
        listeners.onStatus && listeners.onStatus("Connected", canFinishWhileRunning);
        scheduleStartupInput(700);
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "output") {
          outputBacklog.push(message.data);
          if (termReady) {
            term.write(message.data);
          } else if (listeners.onOutput) {
            listeners.onOutput(message.data);
          }
          scheduleStartupInput();
          return;
        }
        if (message.type === "status") {
          listeners.onStatus && listeners.onStatus(message.status, Boolean(message.canFinish));
        }
      });
      socket.addEventListener("close", () => {
        listeners.onClose && listeners.onClose();
      });
    }

    function classifyStatus(text, canFinish) {
      const lower = text.toLowerCase();
      if (lower.includes("done.") || lower.startsWith("task complete")) return "done";
      if (lower.includes("error") || lower.includes("unavailable") || /exited [^0]/.test(lower)) return "error";
      if (canFinish) return "ready";
      return "working";
    }

    function parseSteps(text) {
      if (!text) return [];
      const trimmed = text.trim();
      if (!trimmed) return [];
      const lines = trimmed.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return [];
      return lines.map((line) => line.replace(/^([0-9]+[.)]\\s+|[-*•]\\s+)/, ""));
    }

    function CheckIcon() {
      return h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        h("polyline", { points: "4 12 10 18 20 6", fill: "none", stroke: "currentColor", strokeWidth: "2.6", strokeLinecap: "round", strokeLinejoin: "round" })
      );
    }

    function Header(props) {
      return h("header", { className: "app-header" },
        h("div", { className: "brand" },
          h("div", { className: "brand-mark", "aria-hidden": "true" }, "F"),
          h("span", { className: "brand-wordmark" }, "Freestyle"),
          h("span", { className: "brand-divider", "aria-hidden": "true" }),
          h("span", { className: "brand-node" }, props.node),
        ),
        h("div", null),
        h("div", { className: "status-pill", "data-state": props.state, role: "status", "aria-live": "polite", title: props.text },
          h("span", { className: "status-dot", "aria-hidden": "true" }),
          h("span", { className: "status-text" }, props.text),
        ),
      );
    }

    function InstructionsPane(props) {
      const steps = useMemo(() => parseSteps(props.instructions), [props.instructions]);
      const showSteps = steps.length > 1;
      const buttonDisabled = !props.canFinish || props.done;
      return h("section", { className: "instructions-pane", "aria-label": "Task instructions" },
        h("p", { className: "eyebrow" }, "Interactive task"),
        h("h1", { className: "task-title" }, props.title),
        props.instructions
          ? (showSteps
              ? h("ol", { className: "instruction-steps" },
                  steps.map((step, i) => h("li", { key: i }, step))
                )
              : h("p", { className: "instruction-text" }, props.instructions))
          : null,
        props.command
          ? h("div", { className: "command-block" },
              h("p", { className: "command-label" }, "Command"),
              h("pre", { className: "command-code" },
                h("span", { className: "command-prompt" }, "$ "),
                props.command,
              ),
            )
          : null,
        h("div", { className: "instructions-cta" },
          h(motion.button, {
            type: "button",
            className: "primary-button",
            disabled: buttonDisabled,
            onClick: props.onFinish,
            whileHover: buttonDisabled ? undefined : { y: -1 },
            whileTap: buttonDisabled ? undefined : { scale: 0.97 },
            transition: { type: "spring", stiffness: 480, damping: 28 },
          },
            h("span", { className: "check" }, h(CheckIcon, null)),
            h("span", null, "Complete task"),
          ),
          h("p", { className: "cta-hint" },
            props.done
              ? "Task complete — you can close this tab."
              : (props.canFinish
                  ? "When the command above has finished in the terminal, click here to continue."
                  : "Run the command in the terminal — this button will activate when the task is ready to finish.")
          ),
        ),
      );
    }

    function TerminalChrome() {
      const hostRef = useRef(null);
      const fallbackRef = useRef(null);

      useEffect(() => {
        terminalEl = hostRef.current;
        if (fallbackRef.current) {
          for (const chunk of outputBacklog) {
            fallbackRef.current.textContent += chunk;
          }
        }
        listeners.onOutput = (data) => {
          if (!fallbackRef.current) return;
          fallbackRef.current.textContent += data;
          fallbackRef.current.scrollTop = fallbackRef.current.scrollHeight;
        };

        let cancelled = false;
        (async () => {
          try {
            const [{ WTerm }, { GhosttyCore }] = await Promise.all([
              import("https://esm.sh/@wterm/dom@0.3.0?bundle"),
              import("https://esm.sh/@wterm/ghostty@0.3.0?bundle"),
            ]);
            if (cancelled || !hostRef.current) return;
            const core = await GhosttyCore.load({
              wasmPath: "https://esm.sh/@wterm/ghostty@0.3.0/wasm/ghostty-vt.wasm",
            });
            if (cancelled || !hostRef.current) return;
            term = new WTerm(hostRef.current, {
              core,
              cols: 100,
              rows: 28,
              autoResize: true,
              cursorBlink: true,
              onData(data) { sendTerminalInput(data); },
              onResize(cols, rows) {
                if (socket && socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: "resize", cols, rows }));
                }
              },
            });
            await term.init();
            for (const chunk of outputBacklog) term.write(chunk);
            termReady = true;
            hostRef.current.classList.add("ready");
            fallbackRef.current && fallbackRef.current.classList.add("hidden");
            term.focus();
          } catch (error) {
            console.error(error);
            if (fallbackRef.current) {
              fallbackRef.current.textContent += "\\nUnable to load the libghostty renderer. Output will continue here.\\n";
            }
          }
        })();

        return () => { cancelled = true; };
      }, []);

      return h(F, null,
        h("div", { className: "term-titlebar" },
          h("div", { className: "lights", "aria-hidden": "true" },
            h("span", { className: "light red" }),
            h("span", { className: "light yellow" }),
            h("span", { className: "light green" }),
          ),
          h("span", { className: "term-titlebar-label" }, NODE_PATH + " · terminal"),
        ),
        h("div", { className: "terminal-shell" },
          h("pre", { ref: fallbackRef, className: "term-fallback" }, "Starting terminal...\\n"),
          h("div", { ref: hostRef, className: "term-host" }),
        ),
      );
    }

    function SuccessPane(props) {
      return h(motion.div, {
        className: "success-pane",
        initial: { opacity: 0, scale: 0.96, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97 },
        transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.18 },
      },
        h("div", { className: "success-card", role: "status", "aria-live": "polite" },
          h(motion.div, {
            className: "success-icon",
            initial: { scale: 0.5, opacity: 0 },
            animate: { scale: 1, opacity: 1 },
            transition: { type: "spring", stiffness: 320, damping: 18, delay: 0.32 },
          },
            h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
              h(motion.polyline, {
                points: "4 12 10 18 20 6",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: "3",
                strokeLinecap: "round",
                strokeLinejoin: "round",
                initial: { pathLength: 0 },
                animate: { pathLength: 1 },
                transition: { duration: 0.5, ease: "easeOut", delay: 0.5 },
              })
            )
          ),
          h(motion.h2, {
            className: "success-title",
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.35, delay: 0.55 },
          }, "Task complete"),
          h(motion.p, {
            className: "success-message",
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.35, delay: 0.65 },
          }, "You can close this tab — Rigkit will pick up from here."),
          h(motion.span, {
            className: "success-meta",
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { duration: 0.35, delay: 0.75 },
          },
            h("span", { className: "success-meta-dot", "aria-hidden": "true" }),
            props.taskTitle,
          ),
        ),
      );
    }

    function App() {
      const [statusText, setStatusText] = useState(INITIAL_COMPLETED ? "Task complete" : "Starting terminal");
      const [statusState, setStatusState] = useState(INITIAL_COMPLETED ? "done" : "working");
      const [canFinish, setCanFinish] = useState(false);
      const [done, setDone] = useState(INITIAL_COMPLETED);

      useEffect(() => {
        listeners.onStatus = (text, canFinishVal) => {
          setStatusText(text);
          setCanFinish(canFinishVal);
          const state = classifyStatus(text, canFinishVal);
          setStatusState(state);
          if (state === "done") setDone(true);
        };
        listeners.onClose = () => {
          setStatusText((prev) => prev.toLowerCase().includes("done") ? prev : "Terminal connection closed");
        };
        if (!INITIAL_COMPLETED) setupSocket();
        return () => {
          listeners.onStatus = null;
          listeners.onClose = null;
        };
      }, []);

      const handleFinish = useCallback(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "finish" }));
        } else {
          fetch("/complete?token=" + encodeURIComponent(token), { method: "POST" }).catch(() => {});
        }
        setStatusText("Finishing");
        setStatusState("working");
        setCanFinish(false);
        setDone(true);
      }, []);

      return h(F, null,
        h(Header, { node: NODE_PATH, text: statusText, state: statusState }),
        h("main", { className: "workspace" },
          h(InstructionsPane, {
            title: TASK_TITLE,
            instructions: TASK_INSTRUCTIONS,
            command: TASK_COMMAND,
            canFinish: canFinish,
            done: done,
            onFinish: handleFinish,
          }),
          h("div", { className: "right-pane" },
            h(AnimatePresence, { mode: "popLayout", initial: false },
              !done
                ? h(motion.div, {
                    key: "terminal",
                    className: "terminal-window",
                    initial: { opacity: 0, x: 24 },
                    animate: { opacity: 1, x: 0 },
                    exit: { x: "115%", opacity: 0, scale: 0.96, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
                    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
                  }, h(TerminalChrome, null))
                : h(SuccessPane, { key: "success", taskTitle: TASK_TITLE })
            )
          )
        )
      );
    }

    createRoot(document.getElementById("app")).render(h(App));
  </script>
</body>
</html>`;
}

function javaScriptLiteral(value: string | boolean | null): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

function canFinishWhileProcessRuns(
  request: FreestyleTerminalSessionRequest,
  startupInput: string | undefined,
): boolean {
  return request.canFinishWhileRunning ?? (!request.displayCommand && !startupInput);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
