import { createHash, randomUUID } from "node:crypto";
import type { RuntimeClient } from "@stoke/runtime-client";
import type {
  ManagedClient,
  ManagedRun,
  ManagedRunEvent,
} from "@stoke/managed";
import { managedClientFromEnvironment } from "./managed.ts";

const CLAIM_TIMEOUT_MS = 2_500;
const EVENT_ACK_TIMEOUT_MS = 2_500;

export type ManagedApplyClaim = {
  client: ManagedClient;
  run: ManagedRun;
  disposition: "created" | "joined";
  socketUrl: string;
};

export type ManagedRunPublisher = {
  publish(event: unknown, waitForAck?: boolean): Promise<void>;
  close(): void;
};

export async function tryClaimManagedApply(
  runtime: RuntimeClient,
  operation: string,
  input: Record<string, unknown>,
): Promise<ManagedApplyClaim | undefined> {
  if (operation !== "apply") return undefined;
  const projectId = process.env.STOKE_PROJECT_ID;
  const checkoutId = process.env.STOKE_CHECKOUT_ID;
  if (!projectId || !checkoutId) return undefined;

  try {
    const client = managedClientFromEnvironment();
    const workflow = typeof input.workflow === "string" && input.workflow.trim()
      ? input.workflow.trim()
      : "default";
    const fingerprint = createHash("sha256")
      .update(stableJson({
        projectId,
        checkoutId,
        operation,
        workflow,
        input,
        runtimeFingerprint: runtime.handle.runtimeFingerprint ?? runtime.handle.projectId,
      }))
      .digest("hex");
    const claimed = await withTimeout(client.claimRun({
      projectId,
      checkoutId,
      operation: "apply",
      workflow,
      fingerprint: `sha256-${fingerprint}`,
    }), CLAIM_TIMEOUT_MS);
    return { client, ...claimed };
  } catch {
    return undefined;
  }
}

export function createManagedRunPublisher(
  socketUrl: string,
  refreshSocketUrl?: () => Promise<string>,
  required = false,
): ManagedRunPublisher {
  const queue: string[] = [];
  const pending = new Map<string, () => void>();
  let socket: WebSocket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function connect(url: string): void {
    if (closed) return;
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      for (const message of queue.splice(0)) socket?.send(message);
    });
    socket.addEventListener("message", (message) => {
      try {
        const data = JSON.parse(String(message.data)) as Record<string, unknown>;
        if (data.type === "event.ack" && typeof data.clientEventId === "string") {
          pending.get(data.clientEventId)?.();
          pending.delete(data.clientEventId);
        }
      } catch {
        // Managed telemetry is intentionally best-effort.
      }
    });
    socket.addEventListener("close", () => {
      socket = undefined;
      if (!closed && refreshSocketUrl) {
        reconnect = setTimeout(async () => {
          try {
            connect(await refreshSocketUrl());
          } catch {
            if (!closed) connectLater();
          }
        }, 1_000);
      }
    });
    socket.addEventListener("error", () => {
      // Local execution must continue if managed telemetry is unavailable.
    });
  }

  function connectLater(): void {
    reconnect = setTimeout(async () => {
      try {
        if (refreshSocketUrl) connect(await refreshSocketUrl());
      } catch {
        if (!closed) connectLater();
      }
    }, 2_500);
  }

  connect(socketUrl);

  const heartbeat = setInterval(() => {
    send(JSON.stringify({ type: "heartbeat" }));
  }, 20_000);

  function send(message: string): void {
    if (closed) return;
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
    else if (queue.length < 500) queue.push(message);
  }

  return {
    async publish(event, waitForAck = false) {
      const id = randomUUID();
      let acknowledgement: Promise<void> | undefined;
      if (waitForAck) {
        acknowledgement = new Promise((resolve) => pending.set(id, resolve));
      }
      send(JSON.stringify({ type: "event", id, event }));
      if (acknowledgement) {
        const acknowledged = withTimeout(acknowledgement, EVENT_ACK_TIMEOUT_MS);
        if (required) await acknowledged;
        else await acknowledged.catch(() => undefined);
      }
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      if (reconnect) clearTimeout(reconnect);
      for (const resolve of pending.values()) resolve();
      pending.clear();
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

export async function followManagedRun(
  claim: ManagedApplyClaim,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
): Promise<ManagedRun> {
  let socketUrl = claim.socketUrl;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const observed = await observeSocket(socketUrl, onEvent).catch(() => undefined);
    if (observed && observed.status !== "running") return observed;
    const run = await claim.client.getRun(claim.run.id);
    if (run.status !== "running") return run;
    await delay(Math.min(250 * 2 ** attempt, 4_000));
    socketUrl = await claim.client.createRunSocketTicket(run.id, "viewer");
  }
  throw new Error(`Managed run ${claim.run.id} remained unavailable`);
}

export function managedRunResult(run: ManagedRun): Record<string, unknown> {
  if (run.status === "failed" || run.status === "orphaned") {
    throw new Error(run.error ?? `Managed apply ${run.status}`);
  }
  return {
    deduplicated: true,
    managedRunId: run.id,
    plan: {
      workflow: run.workflow,
      providerFingerprint: "managed-single-flight",
      cachedNodeCount: run.cachedNodeCount ?? 0,
      nodeCount: run.nodeCount ?? 0,
      nodes: [],
    },
  };
}

function observeSocket(
  socketUrl: string,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
): Promise<ManagedRun | undefined> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let latest: ManagedRun | undefined;
    socket.addEventListener("message", (message) => {
      try {
        const data = JSON.parse(String(message.data)) as Record<string, unknown>;
        if (data.type === "events" && Array.isArray(data.events)) {
          for (const item of data.events as ManagedRunEvent[]) {
            if (typeof item.data.type === "string") {
              onEvent(item.data as { type: string; [key: string]: unknown });
            }
          }
        }
        if (data.type === "run" && isManagedRun(data.run)) {
          latest = data.run;
          if (latest.status !== "running") {
            socket.close();
            resolve(latest);
          }
        }
      } catch (error) {
        socket.close();
        reject(error);
      }
    });
    socket.addEventListener("error", () => reject(new Error("Managed run socket failed")));
    socket.addEventListener("close", () => resolve(latest));
  });
}

function isManagedRun(value: unknown): value is ManagedRun {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "status" in value && typeof value.status === "string";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Managed run request timed out")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
