import type { ServerWebSocket, Subprocess } from "bun";
import type { TerminalInteractionHandler, TerminalInteractionRequest } from "@freestyle-sh/fdev-engine";

export type LocalInteractionSession = {
  url: string;
  completed: Promise<void>;
  stop(): void;
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

export function createLocalTerminalInteraction(): TerminalInteractionHandler {
  return async (request) => {
    const session = createLocalInteractionSession(request);

    console.error(`\nInteractive step: ${request.label}`);
    if (request.instructions) console.error(request.instructions);
    console.error(`Open ${session.url}`);
    console.error(request.command);

    openUrl(session.url);

    try {
      await session.completed;
    } finally {
      session.stop();
    }
  };
}

export function createLocalInteractionSession(request: TerminalInteractionRequest): LocalInteractionSession {
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
  let complete!: () => void;
  let fail!: (error: Error) => void;
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const outputBuffer: string[] = [];
  const startupInput = request.remoteCommand ? ensureTrailingNewline(request.remoteCommand) : undefined;

  const completed = new Promise<void>((resolve, reject) => {
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
    url: `http://127.0.0.1:${server.port}/?token=${encodeURIComponent(token)}`,
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
      canFinish: false,
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
        const error = new Error(`Interactive command "${request.label}" exited ${code}`);
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
        status: `Running ${request.remoteCommand}`,
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
    complete();
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
      send(ws, { type: "status", status: `Running ${request.remoteCommand}`, canFinish: true });
      return;
    }
    send(ws, { type: "status", status: proc ? "Connected" : "Starting", canFinish: !request.remoteCommand });
  }

  function broadcast(message: ServerMessage): void {
    for (const socket of sockets) send(socket, message);
  }
}

function openUrl(url: string): void {
  if (process.env.FDEV_NO_BROWSER === "1") return;

  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  try {
    const proc = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.exited.catch(() => {});
  } catch {
    // The terminal output includes the URL, so a failed opener still has a manual path.
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
  request: TerminalInteractionRequest,
  options: { completed?: boolean; startupInput?: string } = {},
): string {
  const completed = options.completed ?? false;
  const escapedTitle = escapeHtml(completed ? "Interactive step completed" : request.label);
  const escapedStep = escapeHtml(request.step);
  const escapedLabel = escapeHtml(request.label);
  const escapedInstructions = request.instructions ? escapeHtml(request.instructions) : "";
  const escapedCommand = escapeHtml(request.remoteCommand ?? request.command);
  const startupInputLiteral = javaScriptLiteral(options.startupInput ?? null);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedTitle}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      color: #f5f5f5;
    }
    body {
      margin: 0;
      height: 100vh;
      padding: 24px;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      overflow: hidden;
      background:
        radial-gradient(circle at 18% 0%, rgba(82, 82, 91, 0.16), transparent 28%),
        #0a0a0a;
    }
    .terminal-window {
      width: min(1120px, 100%);
      height: min(760px, calc(100vh - 48px));
      min-height: 420px;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 1px solid #2b2b2f;
      border-radius: 8px;
      background: #0b0f14;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
    }
    .titlebar {
      min-height: 50px;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 11px 14px;
      border-bottom: 1px solid #27272a;
      background: linear-gradient(#1c1c20, #17171a);
      box-sizing: border-box;
    }
    .lights {
      display: flex;
      gap: 7px;
      flex: 0 0 auto;
    }
    .light {
      width: 11px;
      height: 11px;
      border-radius: 999px;
      background: #3f3f46;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
    }
    .light.red {
      background: #ff5f57;
    }
    .light.yellow {
      background: #febc2e;
    }
    .light.green {
      background: #28c840;
    }
    .title-copy {
      min-width: 0;
      flex: 1;
    }
    .meta {
      margin: 0 0 3px;
      color: #a1a1aa;
      font-size: 12px;
    }
    h1 {
      margin: 0;
      font-size: 14px;
      line-height: 1.25;
      font-weight: 600;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .instructions {
      margin: 4px 0 0;
      white-space: pre-wrap;
      color: #a1a1aa;
      line-height: 1.35;
      font-size: 12px;
    }
    .command {
      margin: 0;
      padding: 8px 12px;
      border-bottom: 1px solid #1f2937;
      background: #0f1720;
      color: #7dd3fc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .terminal-shell {
      min-height: 0;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: #0b0f14;
      user-select: text;
    }
    #terminal {
      position: absolute;
      inset: 0;
      border-radius: 0;
      box-shadow: none;
      user-select: text;
      --term-bg: #0b0f14;
      --term-fg: #e5e7eb;
      --term-cursor: #f8fafc;
      --term-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      --term-font-size: 13px;
      --term-row-height: 17px;
      --term-color-0: #1f2937;
      --term-color-1: #ef4444;
      --term-color-2: #22c55e;
      --term-color-3: #eab308;
      --term-color-4: #38bdf8;
      --term-color-5: #a78bfa;
      --term-color-6: #2dd4bf;
      --term-color-7: #e5e7eb;
      --term-color-8: #6b7280;
      --term-color-9: #f87171;
      --term-color-10: #4ade80;
      --term-color-11: #facc15;
      --term-color-12: #7dd3fc;
      --term-color-13: #c4b5fd;
      --term-color-14: #5eead4;
      --term-color-15: #ffffff;
    }
    #terminal:not(.ready) {
      visibility: hidden;
    }
    #fallback {
      position: absolute;
      inset: 0;
      z-index: 1;
      box-sizing: border-box;
      margin: 0;
      padding: 14px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #0b0f14;
      color: #e5e7eb;
      user-select: text;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.35;
    }
    #fallback.hidden {
      display: none;
    }
    .wterm {
      position: relative;
      background: var(--term-bg);
      color: var(--term-fg);
      font-family: var(--term-font-family);
      font-size: var(--term-font-size);
      line-height: 1.2;
      padding: 12px;
      outline: none;
      overflow: auto;
      user-select: text;
    }
    .term-grid {
      display: block;
      white-space: pre;
      contain: layout paint style;
      user-select: text;
    }
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
    .term-block {
      width: 1ch;
      overflow: hidden;
    }
    .term-cursor {
      outline: 1px solid var(--term-cursor);
      outline-offset: -1px;
    }
    .wterm.focused .term-cursor {
      background: var(--term-cursor);
      color: var(--term-bg);
      outline: none;
    }
    footer {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 11px 14px;
      border-top: 1px solid #27272a;
      background: #17171a;
    }
    #status {
      flex: 1;
      min-width: 0;
      color: #cbd5e1;
      font-size: 12px;
    }
    button {
      border: 0;
      border-radius: 6px;
      background: #f5f5f5;
      color: #111111;
      min-width: 82px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 8px 12px;
    }
    button:hover:not(:disabled) {
      background: #ffffff;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
    @media (max-width: 720px) {
      body {
        padding: 0;
      }
      .terminal-window {
        height: 100vh;
        min-height: 100vh;
        border: 0;
        border-radius: 0;
      }
      .instructions {
        display: none;
      }
    }
  </style>
</head>
<body>
  <section class="terminal-window">
    <header class="titlebar">
      <div class="lights" aria-hidden="true">
        <span class="light red"></span>
        <span class="light yellow"></span>
        <span class="light green"></span>
      </div>
      <div class="title-copy">
        <p class="meta">fdev step ${escapedStep}</p>
        <h1>${escapedLabel}</h1>
        ${escapedInstructions ? `<p class="instructions">${escapedInstructions}</p>` : ""}
      </div>
    </header>
    <p class="command">$ ${escapedCommand}</p>
    <main class="terminal-shell" aria-label="Interactive terminal">
      <pre id="fallback">Starting terminal...\n</pre>
      <div id="terminal"></div>
    </main>
    <footer>
      <span id="status">${completed ? "Done. You can close this page now." : "Starting terminal"}</span>
      <button id="finish" type="button" disabled>Finished</button>
    </footer>
  </section>
  <script type="module">
    const token = new URLSearchParams(location.search).get("token") || "";
    const terminalUrl = new URL("/terminal", location.href);
    terminalUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    terminalUrl.searchParams.set("token", token);
    const statusEl = document.getElementById("status");
    const finishEl = document.getElementById("finish");
    const terminalEl = document.getElementById("terminal");
    const fallbackEl = document.getElementById("fallback");
    const outputBacklog = [];
    let socket;
    let term;
    let termReady = false;
    const startupInput = ${startupInputLiteral};
    let startupSent = false;
    let startupIdleTimer;
    let startupMaxTimer;

    function sendTerminalInput(data) {
      if (!data || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "input", data }));
    }

    function setStatus(text, canFinish = false) {
      statusEl.textContent = text;
      finishEl.disabled = !canFinish;
    }

    function appendFallback(data) {
      fallbackEl.textContent += data;
      fallbackEl.scrollTop = fallbackEl.scrollHeight;
    }

    function sendStartupInput() {
      if (!startupInput || startupSent || socket.readyState !== WebSocket.OPEN) return;
      startupSent = true;
      clearTimeout(startupIdleTimer);
      clearTimeout(startupMaxTimer);
      sendTerminalInput(startupInput);
    }

    function scheduleStartupInput(delay = 350) {
      if (!startupInput || startupSent || socket.readyState !== WebSocket.OPEN) return;
      clearTimeout(startupIdleTimer);
      startupIdleTimer = setTimeout(sendStartupInput, delay);
      startupMaxTimer ??= setTimeout(sendStartupInput, 1500);
    }

    socket = new WebSocket(terminalUrl);
    socket.addEventListener("open", () => {
      setStatus("Connected");
      scheduleStartupInput(700);
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "output") {
        outputBacklog.push(message.data);
        if (termReady) {
          term.write(message.data);
        } else {
          appendFallback(message.data);
        }
        scheduleStartupInput();
        return;
      }
      if (message.type === "status") {
        setStatus(message.status, Boolean(message.canFinish));
      }
    });
    socket.addEventListener("close", () => {
      if (finishEl.disabled) setStatus("Terminal connection closed");
    });
    finishEl.addEventListener("click", () => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "finish" }));
      } else {
        fetch("/complete?token=" + encodeURIComponent(token), { method: "POST" }).catch(() => {});
      }
      setStatus("Finishing");
      finishEl.disabled = true;
    });
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      const data = keyEventToTerminalInput(event);
      if (!data) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      term?.focus();
      sendTerminalInput(data);
    }, { capture: true });

    try {
      const [{ WTerm }, { GhosttyCore }] = await Promise.all([
        import("https://esm.sh/@wterm/dom@0.3.0?bundle"),
        import("https://esm.sh/@wterm/ghostty@0.3.0?bundle"),
      ]);
      const core = await GhosttyCore.load({
        wasmPath: "https://esm.sh/@wterm/ghostty@0.3.0/wasm/ghostty-vt.wasm",
      });
      term = new WTerm(terminalEl, {
        core,
        cols: 100,
        rows: 28,
        autoResize: true,
        cursorBlink: true,
        onData(data) {
          sendTerminalInput(data);
        },
        onResize(cols, rows) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        },
      });
      await term.init();
      for (const chunk of outputBacklog) term.write(chunk);
      termReady = true;
      terminalEl.classList.add("ready");
      fallbackEl.classList.add("hidden");
      term.focus();
    } catch (error) {
      console.error(error);
      appendFallback("\\nUnable to load the libghostty renderer. Output will continue here.\\n");
      setStatus("Renderer unavailable. Command output is shown in fallback mode.", !startupInput || startupSent);
    }

    function isTextEditingTarget(target) {
      if (!(target instanceof Element)) return false;
      if (terminalEl.contains(target)) return false;
      if (target === finishEl) return true;
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
  </script>
</body>
</html>`;
}

function javaScriptLiteral(value: string | null): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
