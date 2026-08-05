import { createManagedClient } from "@usestoke/managed";
import { defineHostCapability, type HostCapabilityHandler } from "@usestoke/sdk/host";
import WebSocket from "ws";
import {
  SSH_CAPABILITY,
  parseVercelSandboxSshInput,
} from "./capabilities.ts";
import { readStokeAccessToken } from "./provider.ts";

export type OpenInteractiveSsh = (sandbox: string) => Promise<void>;

export function createVercelSandboxSshHostCapability(
  options: { open?: OpenInteractiveSsh } = {},
): HostCapabilityHandler {
  return defineHostCapability(SSH_CAPABILITY.id, {
    schemaHash: SSH_CAPABILITY.schemaHash,
    async handle(params) {
      const input = parseVercelSandboxSshInput(params);
      return {
        attached: true,
        closed: (options.open ?? openManagedInteractiveShell)(input.sandbox),
      };
    },
  });
}

export const vercelSandboxHostCapabilities = [
  createVercelSandboxSshHostCapability(),
] as const;

async function openManagedInteractiveShell(sandbox: string): Promise<void> {
  const projectId = process.env.STOKE_PROJECT_ID;
  if (!projectId) throw new Error("A managed Stoke project must be selected before opening SSH");
  const client = createManagedClient({
    baseUrl: process.env.STOKE_API_URL ?? "https://usestoke.dev",
    token: readStokeAccessToken,
  });
  const interactive = await client.openSandboxInteractive(sandbox, projectId);
  await bridgeTerminal(interactive.url, interactive.token);
}

async function bridgeTerminal(url: string, token: string): Promise<void> {
  const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const stdin = process.stdin;
  const stdout = process.stdout;
  const wasRaw = stdin.isRaw;
  const sendResize = () => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: "resize",
      cols: stdout.columns ?? 80,
      rows: stdout.rows ?? 24,
    }));
  };
  const sendInput = (chunk: Buffer) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
  };

  socket.send(JSON.stringify({
    type: "start",
    command: "bash",
    args: ["-l"],
    env: [`TERM=${process.env.TERM ?? "xterm-256color"}`],
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  }));
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      stdout.write(rawDataBuffer(data));
      return;
    }
    try {
      const message = JSON.parse(data.toString()) as { type?: string; code?: number };
      if (message.type === "exit" && typeof message.code === "number" && message.code !== 0) {
        process.exitCode = message.code;
      }
    } catch {
      stdout.write(rawDataBuffer(data));
    }
  });
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", sendInput);
  process.on("SIGWINCH", sendResize);

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("close", () => resolve());
      socket.once("error", reject);
    });
  } finally {
    process.removeListener("SIGWINCH", sendResize);
    stdin.removeListener("data", sendInput);
    if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
    stdin.pause();
    if (socket.readyState === WebSocket.OPEN) socket.close();
  }
}

function rawDataBuffer(data: WebSocket.RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}
