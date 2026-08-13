import { createHash, randomUUID } from "node:crypto";
import type { RuntimeClient } from "@usestoke/runtime-client";
import type {
  ManagedClient,
  ManagedRun,
} from "@usestoke/managed";
import { managedClientFromEnvironment } from "./managed.ts";

const CLAIM_TIMEOUT_MS = 2_500;
const RUN_FALLBACK_POLL_MS = 5_000;
const RUN_FOLLOW_TIMEOUT_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export type ManagedApplyClaim = {
  client: ManagedClient;
  run: ManagedRun;
  disposition: "created" | "joined";
};

export type ManagedRunPublisher = {
  publish(event: unknown, waitForAck?: boolean): Promise<void>;
  onHostResponse(handler: (response: ManagedHostResponse) => void | Promise<void>): void;
  close(): void;
};

export type ManagedHostResponse = {
  id: string;
  result?: unknown;
  error?: { code?: string; message?: string };
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
  client: ManagedClient,
  runId: string,
  required = false,
): ManagedRunPublisher {
  let hostResponseHandler: ((response: ManagedHostResponse) => void | Promise<void>) | undefined;
  let responseCursor = 0;
  let responsePolling = false;
  let notificationSocket: WebSocket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const heartbeat = setInterval(() => {
    if (!closed) void client.heartbeatRun(runId).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
  const responseFallback = setInterval(() => {
    if (!closed) void pollHostResponses();
  }, RUN_FALLBACK_POLL_MS);

  async function pollHostResponses(): Promise<void> {
    if (closed || responsePolling || !hostResponseHandler) return;
    responsePolling = true;
    try {
      const events = await client.listRunEvents(runId, responseCursor);
      if (events.length) responseCursor = events.at(-1)?.id ?? responseCursor;
      for (const event of events) {
        if (
          event.data.type !== "host.capability.response"
          || typeof event.data.requestId !== "string"
        ) continue;
        await hostResponseHandler({
          id: event.data.requestId,
          ...(event.data.result !== undefined ? { result: event.data.result } : {}),
          ...(isHostResponseError(event.data.error) ? { error: event.data.error } : {}),
        });
      }
    } catch {
      // The next poll catches up from the last persisted event cursor.
    } finally {
      responsePolling = false;
    }
  }

  async function connectNotifications(): Promise<void> {
    if (closed || notificationSocket || !hostResponseHandler) return;
    try {
      const socketUrl = await client.createRunSocketTicket(runId);
      if (closed || !hostResponseHandler) return;
      const socket = new WebSocket(socketUrl);
      notificationSocket = socket;
      socket.addEventListener("message", (message) => {
        try {
          const data = JSON.parse(String(message.data)) as Record<string, unknown>;
          if (data.type === "run.changed") void pollHostResponses();
        } catch {
          // A reconnect always triggers an authoritative HTTP catch-up.
        }
      });
      socket.addEventListener("close", () => {
        if (notificationSocket === socket) notificationSocket = undefined;
        scheduleReconnect();
      });
      socket.addEventListener("error", () => socket.close());
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (closed || reconnect || !hostResponseHandler) return;
    reconnect = setTimeout(() => {
      reconnect = undefined;
      void connectNotifications();
    }, 1_000);
  }

  return {
    async publish(event, waitForAck = false) {
      if (!isManagedRunEvent(event)) {
        const error = new Error("Managed run events require a string type");
        if (required || waitForAck) throw error;
        return;
      }
      const request = client.appendRunEvent(runId, {
        clientEventId: randomUUID(),
        event,
      });
      if (required || waitForAck) await request;
      else await request.catch(() => undefined);
    },
    onHostResponse(handler) {
      hostResponseHandler = handler;
      void pollHostResponses();
      void connectNotifications();
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(responseFallback);
      if (reconnect) clearTimeout(reconnect);
      notificationSocket?.close();
      hostResponseHandler = undefined;
    },
  };
}

function isHostResponseError(value: unknown): value is { code?: string; message?: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedRunEvent(value: unknown): value is { type: string; [key: string]: unknown } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "type" in value
    && typeof value.type === "string";
}

export async function followManagedRun(
  claim: ManagedApplyClaim,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
): Promise<ManagedRun> {
  const deadline = Date.now() + RUN_FOLLOW_TIMEOUT_MS;
  const notifications = createRunChangeWaiter(claim.client, claim.run.id);
  let cursor = 0;
  try {
    while (Date.now() < deadline) {
      const events = await claim.client.listRunEvents(claim.run.id, cursor);
      if (events.length) cursor = events.at(-1)?.id ?? cursor;
      for (const event of events) {
        if (typeof event.data.type === "string") {
          onEvent(event.data as { type: string; [key: string]: unknown });
        }
      }
      const run = await claim.client.getRun(claim.run.id);
      if (run.status !== "running") return run;
      await notifications.wait(RUN_FALLBACK_POLL_MS);
    }
  } finally {
    notifications.close();
  }
  throw new Error(`Managed run ${claim.run.id} did not finish within five minutes`);
}

function createRunChangeWaiter(client: ManagedClient, runId: string): {
  wait(timeoutMs: number): Promise<void>;
  close(): void;
} {
  let socket: WebSocket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let waiting: (() => void) | undefined;
  let signaled = false;
  let closed = false;

  const signal = () => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve();
    } else {
      signaled = true;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnect) return;
    reconnect = setTimeout(() => {
      reconnect = undefined;
      void connect();
    }, 1_000);
  };

  const connect = async () => {
    if (closed || socket) return;
    try {
      const socketUrl = await client.createRunSocketTicket(runId);
      if (closed) return;
      const next = new WebSocket(socketUrl);
      socket = next;
      next.addEventListener("message", (message) => {
        try {
          const data = JSON.parse(String(message.data)) as Record<string, unknown>;
          if (data.type === "run.changed") signal();
        } catch {
          // Wait for a valid notification or the fallback refresh.
        }
      });
      next.addEventListener("close", () => {
        if (socket === next) socket = undefined;
        signal();
        scheduleReconnect();
      });
      next.addEventListener("error", () => next.close());
    } catch {
      signal();
      scheduleReconnect();
    }
  };

  void connect();
  return {
    wait(timeoutMs) {
      if (signaled) {
        signaled = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (waiting === finish) waiting = undefined;
          resolve();
        }, timeoutMs);
        const finish = () => {
          clearTimeout(timeout);
          resolve();
        };
        waiting = finish;
      });
    },
    close() {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      waiting?.();
      waiting = undefined;
    },
  };
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
