import type { RuntimeEvent } from "./protocol.ts";

export type RunStatus = "running" | "completed" | "failed";

export type PendingHostResponse = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type RunRecord = {
  id: string;
  operation: string;
  input: unknown;
  status: RunStatus;
  events: RuntimeEvent[];
  result?: unknown;
  error?: { message: string };
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  createdAt: string;
  updatedAt: string;
};

export type RunStore = {
  runs: Map<string, RunRecord>;
  hostResponses: Map<string, PendingHostResponse>;
};

const encoder = new TextEncoder();

export function createRunStore(): RunStore {
  return {
    runs: new Map(),
    hostResponses: new Map(),
  };
}

export function createRun(operation: string, input: unknown): RunRecord {
  const now = new Date().toISOString();
  return {
    id: `run_${crypto.randomUUID()}`,
    operation,
    input,
    status: "running",
    events: [],
    subscribers: new Set(),
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
}

export function completeRun(run: RunRecord, result: unknown): void {
  run.status = "completed";
  run.result = result;
  run.updatedAt = new Date().toISOString();
  emitRunEvent(run, { type: "run.completed", runId: run.id, result });
  closeRunSubscribers(run);
}

export function failRun(run: RunRecord, error: unknown): void {
  run.status = "failed";
  run.error = { message: error instanceof Error ? error.message : String(error) };
  run.updatedAt = new Date().toISOString();
  emitRunEvent(run, { type: "run.failed", runId: run.id, error: run.error });
  closeRunSubscribers(run);
}

export function summarizeRun(run: RunRecord): Record<string, unknown> {
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
  const requestId = `host_req_${crypto.randomUUID()}`;
  emitRunEvent(run, { type: "host.request", requestId, method, params });
  return new Promise<unknown>((resolve, reject) => {
    store.hostResponses.set(requestId, { resolve, reject });
  });
}

function closeRunSubscribers(run: RunRecord): void {
  for (const subscriber of run.subscribers) {
    subscriber.close();
  }
  run.subscribers.clear();
}

function encodeSse(event: RuntimeEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
