import { describe, expect, test } from "bun:test";
import { createFreestyleTerminalSession } from "./terminal-session.ts";

describe("Freestyle terminal session", () => {
  test("serves a wterm page and resolves after the user finishes", async () => {
    const session = createFreestyleTerminalSession({
      nodePath: "login",
      title: "GitHub auth",
      command: localInteractiveShell,
      remoteCommand: "printf interactive-ready",
      instructions: "Authenticate GitHub inside the VM.",
    });

    try {
      const page = await fetch(session.url);
      const html = await page.text();

      expect(page.status).toBe(200);
      expect(html).toContain("GitHub auth");
      expect(html).toContain("Authenticate GitHub inside the VM.");
      expect(html).toContain("printf interactive-ready");
      expect(html).toContain("@wterm/dom");
      expect(html).toContain("@wterm/ghostty");
      expect(html).toContain("terminal-window");
      expect(html).toContain("light red");
      expect(html).toContain("Finished");
      expect(html).toContain("document.addEventListener(\"keydown\"");
      expect(html).toContain("{ capture: true }");
      expect(html).toContain("terminalEl.contains(target)");
      expect(html).toContain("user-select: text");
      expect(html).toContain("keyEventToTerminalInput");
      expect(html).toContain("sendTerminalInput(data)");
      const startupInput = readStartupInput(html);
      expect(startupInput).toBe("printf interactive-ready\n");

      const messages: unknown[] = [];
      const socketUrl = new URL(session.url.replace("/?", "/terminal?"));
      socketUrl.protocol = "ws:";
      const socket = new WebSocket(socketUrl);
      socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(String(event.data)));
      });
      await sendOnOpen(socket, startupInput);

      await waitFor(() =>
        messages.some((message) =>
          isMessage(message, "output") && message.data.includes("interactive-ready")
        ),
      );
      await waitFor(() =>
        messages.some((message) =>
          isMessage(message, "status") && message.status === "Running printf interactive-ready" && message.canFinish
        ),
      );

      socket.send(JSON.stringify({ type: "finish" }));
      await expect(session.completed).resolves.toEqual({ finished: true });
      socket.close();
    } finally {
      session.stop();
    }
  });

  test("keeps the terminal open until the user finishes", async () => {
    const session = createFreestyleTerminalSession({
      nodePath: "login",
      title: "Manual auth",
      command: localInteractiveShell,
      remoteCommand: "printf manual-ready",
    });

    let resolved = false;
    session.completed.then(() => {
      resolved = true;
    });

    try {
      const messages: unknown[] = [];
      const socketUrl = new URL(session.url.replace("/?", "/terminal?"));
      socketUrl.protocol = "ws:";
      const socket = new WebSocket(socketUrl);
      socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(String(event.data)));
      });
      const page = await fetch(session.url);
      const startupInput = readStartupInput(await page.text());
      await sendOnOpen(socket, startupInput);

      await waitFor(() =>
        messages.some((message) =>
          isMessage(message, "status") && message.status === "Running printf manual-ready" && message.canFinish
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(resolved).toBe(false);

      socket.send(JSON.stringify({ type: "finish" }));
      await expect(session.completed).resolves.toEqual({ finished: true });
      socket.close();
    } finally {
      session.stop();
    }
  });

  test("answers cursor position reports for terminal UI prompts", async () => {
    const session = createFreestyleTerminalSession({
      nodePath: "prompt",
      title: "Prompt UI",
      command: cursorPositionProbe,
    });

    try {
      const messages: unknown[] = [];
      const socketUrl = new URL(session.url.replace("/?", "/terminal?"));
      socketUrl.protocol = "ws:";
      const socket = new WebSocket(socketUrl);
      socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(String(event.data)));
      });

      await waitForSocketOpen(socket);

      await waitFor(() =>
        messages.some((message) =>
          isMessage(message, "output") && message.data.includes("CPR:1b5b32383b31303052")
        ),
      );

      socket.send(JSON.stringify({ type: "finish" }));
      await expect(session.completed).resolves.toEqual({ finished: true });
      socket.close();
    } finally {
      session.stop();
    }
  });
});

const localInteractiveShell = "bash --noprofile --norc -i";
const cursorPositionProbe = "node -e " + JSON.stringify([
  "process.stdout.write('\\x1b[6n');",
  "process.stdin.once('data', (chunk) => {",
  "  process.stdout.write('CPR:' + Buffer.from(chunk).toString('hex') + '\\n');",
  "  process.exit(0);",
  "});",
].join(""));

function readStartupInput(html: string): string {
  const match = /const startupInput = (.*);/.exec(html);
  if (!match) throw new Error("startup input was not rendered");
  const value = JSON.parse(match[1]!) as unknown;
  if (typeof value !== "string") throw new Error("startup input was not a string");
  return value;
}

async function sendOnOpen(socket: WebSocket, data: string): Promise<void> {
  await waitForSocketOpen(socket);
  socket.send(JSON.stringify({ type: "input", data }));
}

async function waitForSocketOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve) => {
    socket.addEventListener("open", () => {
      resolve();
    }, { once: true });
  });
}

function isMessage(
  value: unknown,
  type: string,
): value is { type: string; data: string; status: string; canFinish?: boolean } {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === type);
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > 1_000) throw new Error("Timed out waiting for terminal event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
