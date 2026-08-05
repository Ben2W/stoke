import { Socket } from "@effect/platform";
import { STOKE_ENGINE_VERSION } from "@usestoke/engine";
import { Effect, type Scope } from "effect";
import { STOKE_RUNTIME_VERSION } from "./version.ts";
import {
  RuntimeHostRequestError,
  RuntimeRunCancelledError,
} from "./errors.ts";
import { clearPendingHostRequest, type RuntimeAppState } from "./control.ts";
import {
  RUNTIME_PROTOCOL_HASH,
  type RuntimeOperation,
} from "./protocol.ts";
import {
  closeHostCapabilityResource,
  failRun,
  subscribeRunEvents,
  type RunRecord,
} from "./runs.ts";

type RuntimeSessionConnection = {
  onMessage(value: unknown): void;
  onClose(): void;
};

type RuntimeSessionTransport = {
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

export function runSessionSocketEffect(
  state: RuntimeAppState,
  runId: string,
  socket: Socket.Socket,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const write = yield* socket.writer;
    let writeQueue = Promise.resolve();
    const enqueue = (message: string | Socket.CloseEvent) => {
      writeQueue = writeQueue.then(() => Effect.runPromise(write(message).pipe(Effect.ignore)));
    };
    const transport: RuntimeSessionTransport = {
      send(message) {
        enqueue(message);
      },
      close(code, reason) {
        enqueue(new Socket.CloseEvent(code, reason));
      },
    };
    const run = state.store.runs.get(runId);
    if (!run) {
      transport.close(1008, `Unknown run ${runId}`);
      return;
    }

    const session = openRunSession(state, run, transport);
    yield* Effect.addFinalizer(() => Effect.sync(() => session.onClose()));
    yield* socket.runRaw((raw) => Effect.sync(() => session.onMessage(raw))).pipe(Effect.ignore);
  });
}

function openRunSession(
  state: RuntimeAppState,
  run: RunRecord,
  socket: RuntimeSessionTransport,
): RuntimeSessionConnection {
  let acknowledged = false;
  let sentEvents = 0;
  state.store.activeSessions += 1;
  state.context.touch();

  const sendBacklog = () => {
    while (sentEvents < run.events.length) {
      socket.send(JSON.stringify(sessionEvent(run.events[sentEvents++])));
    }
  };

  const unsubscribe = subscribeRunEvents(run, () => {
    if (acknowledged) sendBacklog();
  });

  return {
    onMessage(value) {
      state.context.touch();
      const message = parseSessionMessage(value);
      if (!message) return;
      if (message.type === "hello") {
        acknowledged = true;
        sendHelloAck(socket, run);
        sendBacklog();
        return;
      }
      if (message.type === "heartbeat") {
        socket.send(JSON.stringify({ type: "heartbeat.ack", at: new Date().toISOString() }));
        return;
      }
      if (message.type === "run.cancel") {
        failRun(run, new RuntimeRunCancelledError(), state.store);
        acknowledged = true;
        sendBacklog();
        return;
      }
      if (message.type === "host.capability.closed") {
        if (!message.id) return;
        closeHostCapabilityResource(
          state.store,
          message.id,
          message.error
            ? new RuntimeHostRequestError({
              requestId: message.id,
              hostCode: typeof message.error.code === "string" ? message.error.code : undefined,
              message: message.error.message ?? "Host capability resource closed with an error",
            })
            : undefined,
        );
        return;
      }
      if (message.type === "response") {
        if (!message.id) return;
        const pending = state.store.hostResponses.get(message.id);
        if (!pending) return;
        state.store.hostResponses.delete(message.id);
        clearPendingHostRequest(state.store, message.id);
        if (message.error) {
          pending.reject(new RuntimeHostRequestError({
            requestId: message.id,
            hostCode: typeof message.error.code === "string" ? message.error.code : undefined,
            message: message.error.message ?? "Host request failed",
          }));
        } else {
          pending.resolve(message.result ?? null);
        }
      }
    },

    onClose() {
      unsubscribe();
      state.store.activeSessions = Math.max(0, state.store.activeSessions - 1);
    },
  };
}

function sendHelloAck(ws: RuntimeSessionTransport, run: { operation: string; operationDefinition?: RuntimeOperation }): void {
  ws.send(JSON.stringify({
    type: "hello.ack",
    transportVersion: 1,
    runtime: {
      engineVersion: STOKE_ENGINE_VERSION,
      runtimeVersion: STOKE_RUNTIME_VERSION,
      protocolHash: RUNTIME_PROTOCOL_HASH,
    },
    operation: {
      id: run.operation,
    },
  }));
}

function sessionEvent(event: unknown): Record<string, unknown> {
  if (isRecord(event) && event.type === "host.request") {
    return {
      type: "host.request",
      id: typeof event.id === "string" ? event.id : event.requestId,
      method: event.method,
      params: event.params,
    };
  }
  if (isRecord(event) && event.type === "host.capability.request") {
    return {
      type: "host.capability.request",
      id: typeof event.id === "string" ? event.id : event.requestId,
      ...(typeof event.nodePath === "string" ? { nodePath: event.nodePath } : {}),
      capability: event.capability,
      params: event.params,
    };
  }
  if (isRecord(event) && typeof event.type === "string" && event.type.startsWith("run.")) return event;
  return { type: "run.event", event };
}

type SessionMessage = Record<string, unknown> & {
  type: string;
  id?: string;
  result?: unknown;
  error?: { code?: string; message?: string };
};

function parseSessionMessage(value: unknown): SessionMessage | undefined {
  const text = typeof value === "string"
    ? value
    : value instanceof Uint8Array
      ? new TextDecoder().decode(value)
      : undefined;
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined;
    if (parsed.type === "response" && typeof parsed.id !== "string") return undefined;
    return parsed as SessionMessage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
