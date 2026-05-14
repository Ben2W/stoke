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
      color-scheme: light;
      --bg: #efece5;
      --surface: #ffffff;
      --fg: #0a0a0a;
      --muted: #5a5a5a;
      --dim: #8e8a80;
      --border: #d8d2c5;
      --border-strong: #b8b0a0;
      --accent: #2d4df5;
      --accent-soft: #e8ecff;
      --ok: #0f9d58;
      --err: #d93025;
      --term-bg: #faf8f2;
      --term-fg: #1a1a1a;
      --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      --sans: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-family: var(--sans);
      color: var(--fg);
      background: var(--bg);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    #app {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
    }
    .noscript-fallback {
      padding: 32px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
      max-width: 640px;
      margin: 0 auto;
    }
    .app-header {
      display: flex;
      align-items: center;
      padding: 18px 24px 14px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--fg);
    }
    .brand-mark { width: 22px; height: 22px; color: var(--fg); flex: 0 0 auto; }
    .brand-mark svg { width: 100%; height: 100%; display: block; }
    .brand-wordmark {
      font-family: var(--mono);
      font-size: 15px;
      font-weight: 500;
      letter-spacing: -0.01em;
      color: var(--fg);
    }
    .brand-node {
      margin-left: 14px;
      padding-left: 14px;
      border-left: 1px solid var(--border);
      color: var(--muted);
      font-family: var(--mono);
      font-size: 13px;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(360px, 480px) minmax(0, 1fr);
      gap: 22px;
      padding: 0 24px 24px;
      min-height: 0;
      height: 100%;
    }
    .instructions-pane {
      display: flex;
      flex-direction: column;
      gap: 20px;
      min-width: 0;
      padding: 18px 22px 22px;
      overflow: auto;
      user-select: text;
    }
    .eyebrow {
      margin: 0;
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border: 1.5px solid var(--accent);
      border-radius: 8px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .task-title {
      margin: 0;
      font-size: 40px;
      font-weight: 800;
      letter-spacing: -0.035em;
      line-height: 1.02;
      color: var(--fg);
    }
    .instruction-text {
      margin: 0;
      white-space: pre-wrap;
      color: #2a2a2a;
      font-size: 15px;
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
      padding: 2px 0 2px 34px;
      color: #2a2a2a;
      font-size: 15px;
      line-height: 1.5;
    }
    .instruction-steps li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 1px;
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      border: 1.5px solid var(--accent);
      color: var(--accent);
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }
    .instructions-cta {
      margin-top: auto;
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .primary-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 14px 18px;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.005em;
      cursor: pointer;
      color: #ffffff;
      background: var(--fg);
      transition: transform 0.12s ease, background 0.12s ease, opacity 0.12s ease;
    }
    .primary-button:hover:not(:disabled) {
      transform: translateY(-1px);
      background: #1f1f1f;
    }
    .primary-button:active:not(:disabled) {
      transform: translateY(0);
    }
    .primary-button:disabled {
      cursor: not-allowed;
      color: var(--dim);
      background: var(--border);
    }
    .primary-button .check { width: 16px; height: 16px; display: inline-grid; place-items: center; }
    .primary-button .check svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .cta-hint {
      margin: 0;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.5;
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
      border-radius: 10px;
      background: var(--term-bg);
    }
    .term-titlebar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      background: #f2efe7;
    }
    .term-titlebar-icon {
      width: 12px;
      height: 12px;
      color: var(--muted);
      flex: 0 0 auto;
    }
    .term-titlebar-icon svg { width: 100%; height: 100%; display: block; }
    .term-titlebar-label {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 12px;
    }
    .terminal-shell {
      position: relative;
      min-height: 0;
      height: 100%;
      background: var(--term-bg);
      overflow: hidden;
      user-select: text;
    }
    .term-host {
      position: absolute;
      inset: 0;
      user-select: text;
      --term-bg: #faf8f2;
      --term-fg: #1a1a1a;
      --term-cursor: #2d4df5;
      --term-font-family: var(--mono);
      --term-font-size: 13px;
      --term-row-height: 17px;
      --term-color-0: #0a0a0a;
      --term-color-1: #c93250;
      --term-color-2: #1f8b4c;
      --term-color-3: #a17500;
      --term-color-4: #2d4df5;
      --term-color-5: #8e3eff;
      --term-color-6: #0a7783;
      --term-color-7: #5a5a5a;
      --term-color-8: #6a6a6a;
      --term-color-9: #b81e3a;
      --term-color-10: #176a3a;
      --term-color-11: #7a5800;
      --term-color-12: #1a3ad9;
      --term-color-13: #7128df;
      --term-color-14: #06606a;
      --term-color-15: #0a0a0a;
    }
    .term-host:not(.ready) { visibility: hidden; }
    .term-host.link-hover,
    .term-fallback.link-hover {
      cursor: pointer;
    }
    .term-fallback {
      position: absolute;
      inset: 0;
      z-index: 1;
      margin: 0;
      padding: 16px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--term-bg);
      color: var(--fg);
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
    .wterm.focused .term-cursor { background: var(--term-cursor); color: #ffffff; outline: none; }
    .success-pane {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      animation: fadeUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .success-card {
      width: min(420px, 100%);
      padding: 32px 28px 28px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface);
      text-align: center;
    }
    .success-icon {
      width: 52px;
      height: 52px;
      margin: 0 auto 18px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      border: 2px solid var(--accent);
      color: var(--accent);
    }
    .success-icon svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .success-title {
      margin: 0 0 8px;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.025em;
      color: var(--fg);
    }
    .success-message {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }
    @media (max-width: 880px) {
      body { overflow: auto; }
      #app { height: auto; min-height: 100vh; }
      .workspace { grid-template-columns: 1fr; padding: 0 16px 16px; gap: 16px; }
      .right-pane { height: min(640px, 70vh); }
      .task-title { font-size: 32px; }
    }
    @media (max-width: 540px) {
      .app-header { padding: 14px 16px 10px; }
      .brand-node { display: none; }
      .task-title { font-size: 28px; }
      .instructions-pane { padding: 12px 16px 16px; }
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

    const h = React.createElement;
    const F = React.Fragment;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    const TASK_TITLE = ${titleLit};
    const TASK_INSTRUCTIONS = ${instructionsLit};
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
    let terminalOutputTail = "";
    let pendingBrowserPromptUrl = null;
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

    const URL_MATCH_PATTERN = "https?:\\\\/\\\\/[^\\\\s<>\\\"']+";

    function stripAnsi(text) {
      return text.replace(/[\\u001b\\u009b][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))/g, "");
    }

    function normalizeHttpUrl(value) {
      let url = String(value || "").trim();
      while (/[),.;:!?\\]}]+$/.test(url)) url = url.slice(0, -1);
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
      } catch {
        return null;
      }
      return null;
    }

    function urlsInText(text) {
      const urls = [];
      const matcher = new RegExp(URL_MATCH_PATTERN, "ig");
      let match;
      while ((match = matcher.exec(text)) !== null) {
        const raw = match[0];
        const url = normalizeHttpUrl(raw);
        if (url) urls.push({ url, start: match.index, end: match.index + raw.length });
      }
      return urls;
    }

    function urlAtTextIndex(text, index) {
      for (const candidate of urlsInText(text)) {
        if (index >= candidate.start - 1 && index <= candidate.end) return candidate.url;
      }
      return null;
    }

    function findPendingBrowserPromptUrl(text) {
      const cleaned = stripAnsi(text).replace(/\\r(?!\\n)/g, "\\n");
      const currentLine = cleaned.split(/\\n/).pop() || "";
      const match = /Press\\s+Enter\\s+to\\s+open\\s+(https?:\\/\\/\\S+)\\s+in\\s+your\\s+browser/i.exec(currentLine);
      return match ? normalizeHttpUrl(match[1]) : null;
    }

    function trackBrowserPrompt(data) {
      terminalOutputTail = (terminalOutputTail + data).slice(-8000);
      pendingBrowserPromptUrl = findPendingBrowserPromptUrl(terminalOutputTail);
    }

    function openExternalUrl(url) {
      const normalized = normalizeHttpUrl(url);
      if (!normalized) return false;
      const opened = window.open(normalized, "_blank", "noopener,noreferrer");
      return Boolean(opened);
    }

    function openPendingBrowserPrompt() {
      if (!pendingBrowserPromptUrl) return false;
      const url = pendingBrowserPromptUrl;
      pendingBrowserPromptUrl = null;
      return openExternalUrl(url);
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
      if (data === "\\r") openPendingBrowserPrompt();
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
          trackBrowserPrompt(message.data);
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

    function CloudIcon() {
      return h("svg", { viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M22 21H10.5a4.5 4.5 0 0 1-.45-8.97A6.5 6.5 0 0 1 22.86 13H23a4 4 0 0 1 0 8h-1" }),
        h("path", { d: "M11.5 24v3" }),
        h("path", { d: "M16 25v3" }),
        h("path", { d: "M20.5 24v3" })
      );
    }

    function TerminalIcon() {
      return h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("polyline", { points: "4 5 7 8 4 11" }),
        h("line", { x1: "8.5", y1: "11", x2: "12", y2: "11" })
      );
    }

    function Header(props) {
      return h("header", { className: "app-header" },
        h("div", { className: "brand" },
          h("span", { className: "brand-mark", "aria-hidden": "true" }, h(CloudIcon, null)),
          h("span", { className: "brand-wordmark" }, "freestyle.sh"),
          h("span", { className: "brand-node" }, props.node),
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
        h("div", { className: "instructions-cta" },
          h("button", {
            type: "button",
            className: "primary-button",
            disabled: buttonDisabled,
            onClick: props.onFinish,
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
        const host = hostRef.current;
        const fallback = fallbackRef.current;
        terminalEl = host;
        if (fallback) {
          for (const chunk of outputBacklog) {
            fallback.textContent += chunk;
          }
        }
        listeners.onOutput = (data) => {
          if (!fallbackRef.current) return;
          fallbackRef.current.textContent += data;
          fallbackRef.current.scrollTop = fallbackRef.current.scrollHeight;
        };

        const handleTerminalClick = (event) => {
          if (event.defaultPrevented || event.button !== 0) return;
          const selection = window.getSelection();
          if (selection && selection.toString()) return;
          const url = terminalUrlFromEvent(event);
          if (!url) return;
          event.preventDefault();
          event.stopPropagation();
          openExternalUrl(url);
        };
        const handleTerminalPointerMove = (event) => {
          const target = event.currentTarget;
          if (!(target instanceof HTMLElement)) return;
          target.classList.toggle("link-hover", Boolean(terminalUrlFromEvent(event)));
        };
        const handleTerminalPointerLeave = (event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLElement) target.classList.remove("link-hover");
        };

        host?.addEventListener("click", handleTerminalClick);
        host?.addEventListener("pointermove", handleTerminalPointerMove);
        host?.addEventListener("pointerleave", handleTerminalPointerLeave);
        fallback?.addEventListener("click", handleTerminalClick);
        fallback?.addEventListener("pointermove", handleTerminalPointerMove);
        fallback?.addEventListener("pointerleave", handleTerminalPointerLeave);

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

        return () => {
          cancelled = true;
          terminalEl = null;
          host?.removeEventListener("click", handleTerminalClick);
          host?.removeEventListener("pointermove", handleTerminalPointerMove);
          host?.removeEventListener("pointerleave", handleTerminalPointerLeave);
          fallback?.removeEventListener("click", handleTerminalClick);
          fallback?.removeEventListener("pointermove", handleTerminalPointerMove);
          fallback?.removeEventListener("pointerleave", handleTerminalPointerLeave);
        };
      }, []);

      return h(F, null,
        h("div", { className: "term-titlebar" },
          h("span", { className: "term-titlebar-icon", "aria-hidden": "true" }, h(TerminalIcon, null)),
          h("span", { className: "term-titlebar-label" }, NODE_PATH + " · terminal"),
        ),
        h("div", { className: "terminal-shell" },
          h("pre", { ref: fallbackRef, className: "term-fallback" }, "Starting terminal...\\n"),
          h("div", { ref: hostRef, className: "term-host" }),
        ),
      );
    }

    function SuccessPane() {
      return h("div", { className: "success-pane" },
        h("div", { className: "success-card", role: "status", "aria-live": "polite" },
          h("div", { className: "success-icon" },
            h(CheckIcon, null)
          ),
          h("h2", { className: "success-title" }, "Task complete"),
          h("p", { className: "success-message" }, "You can close this tab — Rigkit will pick up from here."),
        ),
      );
    }

    function terminalUrlFromEvent(event) {
      const target = event.target;
      if (!(target instanceof Element)) return null;

      const row = target.closest(".term-row");
      if (row) {
        return terminalUrlFromRowEvent(row, event);
      }

      const fallback = target.closest(".term-fallback");
      if (fallback) {
        return terminalUrlFromPreEvent(fallback, event);
      }

      return null;
    }

    function terminalUrlFromRowEvent(row, event) {
      const text = row.textContent || "";
      if (!text) return null;

      const clickedIndex = textIndexFromRowPoint(row, event.clientX);
      if (clickedIndex !== null) {
        const exactUrl = urlAtTextIndex(text, clickedIndex);
        if (exactUrl) return exactUrl;
      }

      const urls = urlsInText(text);
      return urls.length === 1 ? urls[0].url : null;
    }

    function textIndexFromRowPoint(row, clientX) {
      let offset = 0;
      const spans = row.querySelectorAll("span");
      for (const span of spans) {
        const text = span.textContent || "";
        if (!text) continue;

        const rect = span.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          const charWidth = rect.width / Math.max(text.length, 1);
          if (!Number.isFinite(charWidth) || charWidth <= 0) return offset;
          const index = Math.floor((clientX - rect.left) / charWidth);
          return offset + Math.max(0, Math.min(text.length - 1, index));
        }

        offset += text.length;
      }

      return null;
    }

    function terminalUrlFromPreEvent(pre, event) {
      const text = pre.textContent || "";
      const rect = pre.getBoundingClientRect();
      const style = window.getComputedStyle(pre);
      const lineHeight = parseFloat(style.lineHeight) || 18;
      const fontSize = parseFloat(style.fontSize) || 13;
      const charWidth = fontSize * 0.62;
      const paddingTop = parseFloat(style.paddingTop) || 0;
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const lineIndex = Math.floor((event.clientY - rect.top + pre.scrollTop - paddingTop) / lineHeight);
      const colIndex = Math.floor((event.clientX - rect.left + pre.scrollLeft - paddingLeft) / charWidth);
      const line = text.split("\\n")[lineIndex] || "";
      const exactUrl = urlAtTextIndex(line, Math.max(0, colIndex));
      if (exactUrl) return exactUrl;
      const urls = urlsInText(line);
      return urls.length === 1 ? urls[0].url : null;
    }

    function App() {
      const [canFinish, setCanFinish] = useState(false);
      const [done, setDone] = useState(INITIAL_COMPLETED);

      useEffect(() => {
        listeners.onStatus = (text, canFinishVal) => {
          setCanFinish(canFinishVal);
          if (classifyStatus(text, canFinishVal) === "done") setDone(true);
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
        setCanFinish(false);
        setDone(true);
      }, []);

      return h(F, null,
        h(Header, { node: NODE_PATH }),
        h("main", { className: "workspace" },
          h(InstructionsPane, {
            title: TASK_TITLE,
            instructions: TASK_INSTRUCTIONS,
            canFinish: canFinish,
            done: done,
            onFinish: handleFinish,
          }),
          h("div", { className: "right-pane" },
            !done
              ? h("div", { className: "terminal-window" }, h(TerminalChrome, null))
              : h(SuccessPane, null)
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
