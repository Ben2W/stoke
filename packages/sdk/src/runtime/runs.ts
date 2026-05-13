import type { RuntimeEvent, RuntimeOperation } from "./protocol.ts";
import {
  RuntimeHostRequestError,
  runtimeFailureBody,
} from "./errors.ts";

export type RunStatus = "running" | "completed" | "failed";

export type PendingHostResponse = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type PendingHostCapabilityResource = {
  resolveClosed(): void;
  rejectClosed(error: Error): void;
};

export type HostCapabilitySessionResult<Result = unknown> = {
  result: Result;
  closed: Promise<void>;
};

export type RunRecord = {
  id: string;
  operation: string;
  operationDefinition?: RuntimeOperation;
  input: unknown;
  status: RunStatus;
  events: RuntimeEvent[];
  result?: unknown;
  error?: { code: string; message: string };
  pendingHostRequestIds: Set<string>;
  pendingHostCapabilityResourceIds: Set<string>;
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  eventSubscribers: Set<(event: RuntimeEvent) => void>;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeRunSummary = {
  runId: string;
  operation: string;
  input: unknown;
  status: RunStatus;
  result?: unknown;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
};

export type RunStore = {
  runs: Map<string, RunRecord>;
  hostResponses: Map<string, PendingHostResponse>;
  hostCapabilityResources: Map<string, PendingHostCapabilityResource>;
  activeSessions: number;
};

const encoder = new TextEncoder();

export function createRunStore(): RunStore {
  return {
    runs: new Map(),
    hostResponses: new Map(),
    hostCapabilityResources: new Map(),
    activeSessions: 0,
  };
}

export function createRun(operation: string, input: unknown, operationDefinition?: RuntimeOperation): RunRecord {
  const now = new Date().toISOString();
  return {
    id: `run_${crypto.randomUUID()}`,
    operation,
    operationDefinition,
    input,
    status: "running",
    events: [],
    pendingHostRequestIds: new Set(),
    pendingHostCapabilityResourceIds: new Set(),
    subscribers: new Set(),
    eventSubscribers: new Set(),
    createdAt: now,
    updatedAt: now,
  };
}

export function emitRunEvent(run: RunRecord, event: RuntimeEvent): void {
  run.events.push(event);
  run.updatedAt = new Date().toISOString();
  const payload = encodeSse(event);
  for (const subscriber of run.subscribers) {
    subscriber.enqueue(payload);
  }
  for (const subscriber of run.eventSubscribers) {
    subscriber(event);
  }
}

export function completeRun(run: RunRecord, result: unknown, store?: RunStore): void {
  if (run.status !== "running") return;
  run.status = "completed";
  run.result = result;
  run.updatedAt = new Date().toISOString();
  if (store) {
    settleHostCapabilityResources(run, store, (pending) => pending.resolveClosed());
  }
  emitRunEvent(run, { type: "run.completed", runId: run.id, result });
  closeRunSubscribers(run);
}

export function failRun(run: RunRecord, error: unknown, store?: RunStore): void {
  if (run.status !== "running") return;
  run.status = "failed";
  run.error = runtimeFailureBody(error);
  run.updatedAt = new Date().toISOString();
  if (store) {
    for (const requestId of run.pendingHostRequestIds) {
      const pending = store.hostResponses.get(requestId);
      if (pending) {
        store.hostResponses.delete(requestId);
        pending.reject(new RuntimeHostRequestError({
          message: run.error.message,
          requestId,
          cause: error,
        }));
      }
    }
    run.pendingHostRequestIds.clear();
    settleHostCapabilityResources(run, store, (pending) =>
      pending.rejectClosed(new RuntimeHostRequestError({
        message: run.error?.message ?? "Run failed",
        cause: error,
      }))
    );
  }
  emitRunEvent(run, { type: "run.failed", runId: run.id, error: run.error });
  closeRunSubscribers(run);
}

export function summarizeRun(run: RunRecord): RuntimeRunSummary {
  return {
    runId: run.id,
    operation: run.operation,
    input: run.input,
    status: run.status,
    result: run.result,
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function sseResponse(run: RunRecord): Response {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const event of run.events) controller.enqueue(encodeSse(event));
      if (run.status !== "running") {
        controller.close();
        return;
      }
      run.subscribers.add(controller);
    },
    cancel() {
      if (controllerRef) run.subscribers.delete(controllerRef);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export function requestHost(store: RunStore, run: RunRecord, method: string, params: unknown): Promise<unknown> {
  if (run.status !== "running") {
    return Promise.reject(new RuntimeHostRequestError({
      message: `Run ${run.id} is ${run.status}`,
      method,
    }));
  }
  const requestId = `host_req_${crypto.randomUUID()}`;
  run.pendingHostRequestIds.add(requestId);
  emitRunEvent(run, { type: "host.request", requestId, id: requestId, method, params });
  return new Promise<unknown>((resolve, reject) => {
    store.hostResponses.set(requestId, { resolve, reject });
  });
}

export function requestHostCapability(
  store: RunStore,
  run: RunRecord,
  capability: string,
  params: unknown,
): Promise<unknown> {
  const { requestId } = emitHostCapabilityRequest(run, capability, params);
  return waitForHostResponse(store, requestId);
}

export async function requestHostCapabilitySession<Result = unknown>(
  store: RunStore,
  run: RunRecord,
  capability: string,
  params: unknown,
): Promise<HostCapabilitySessionResult<Result>> {
  const { requestId } = emitHostCapabilityRequest(run, capability, params);
  const closed = new Promise<void>((resolveClosed, rejectClosed) => {
    store.hostCapabilityResources.set(requestId, { resolveClosed, rejectClosed });
    run.pendingHostCapabilityResourceIds.add(requestId);
  });
  const result = await waitForHostResponse(store, requestId).catch((error) => {
    closeHostCapabilityResource(store, requestId, error instanceof Error ? error : new Error(String(error)));
    throw error;
  });
  return { result: result as Result, closed };
}

export function closeHostCapabilityResource(store: RunStore, requestId: string, error?: Error): boolean {
  const pending = store.hostCapabilityResources.get(requestId);
  if (!pending) return false;
  store.hostCapabilityResources.delete(requestId);
  clearPendingHostCapabilityResource(store, requestId);
  if (error) pending.rejectClosed(error);
  else pending.resolveClosed();
  return true;
}

function emitHostCapabilityRequest(
  run: RunRecord,
  capability: string,
  params: unknown,
): { requestId: string } {
  if (run.status !== "running") {
    throw new RuntimeHostRequestError({
      message: `Run ${run.id} is ${run.status}`,
      method: capability,
    });
  }
  const requestId = `cap_req_${crypto.randomUUID()}`;
  run.pendingHostRequestIds.add(requestId);
  emitRunEvent(run, { type: "host.capability.request", requestId, id: requestId, capability, params });
  return { requestId };
}

function waitForHostResponse(store: RunStore, requestId: string): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    store.hostResponses.set(requestId, { resolve, reject });
  });
}

export function subscribeRunEvents(run: RunRecord, handler: (event: RuntimeEvent) => void): () => void {
  run.eventSubscribers.add(handler);
  return () => {
    run.eventSubscribers.delete(handler);
  };
}

function closeRunSubscribers(run: RunRecord): void {
  for (const subscriber of run.subscribers) {
    subscriber.close();
  }
  run.subscribers.clear();
}

function settleHostCapabilityResources(
  run: RunRecord,
  store: RunStore,
  settle: (pending: PendingHostCapabilityResource) => void,
): void {
  for (const requestId of run.pendingHostCapabilityResourceIds) {
    const pending = store.hostCapabilityResources.get(requestId);
    if (!pending) continue;
    store.hostCapabilityResources.delete(requestId);
    settle(pending);
  }
  run.pendingHostCapabilityResourceIds.clear();
}

function clearPendingHostCapabilityResource(store: RunStore, requestId: string): void {
  for (const run of store.runs.values()) {
    run.pendingHostCapabilityResourceIds.delete(requestId);
  }
}

function encodeSse(event: RuntimeEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
