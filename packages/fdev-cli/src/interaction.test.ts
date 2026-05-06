import { describe, expect, test } from "bun:test";
import { createLocalInteractionSession } from "./interaction.ts";

describe("local terminal interaction", () => {
  test("serves a wterm page and resolves after the user finishes", async () => {
    const session = createLocalInteractionSession({
      step: "login",
      label: "GitHub auth",
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
      await session.completed;
      socket.close();
    } finally {
      session.stop();
    }
  });

  test("keeps the terminal open until the user finishes", async () => {
    const session = createLocalInteractionSession({
      step: "login",
      label: "Manual auth",
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
      await session.completed;
      socket.close();
    } finally {
      session.stop();
    }
  });
});

const localInteractiveShell = "bash --noprofile --norc -i";

function readStartupInput(html: string): string {
  const match = /const startupInput = (.*);/.exec(html);
  if (!match) throw new Error("startup input was not rendered");
  const value = JSON.parse(match[1]!) as unknown;
  if (typeof value !== "string") throw new Error("startup input was not a string");
  return value;
}

async function sendOnOpen(socket: WebSocket, data: string): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data }));
    return;
  }

  await new Promise<void>((resolve) => {
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "input", data }));
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
