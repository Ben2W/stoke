import { Socket } from "@effect/platform";
import { FDEV_ENGINE_VERSION } from "@freestyle-sh/fdev-engine";
import { Effect, type Scope } from "effect";
import { FDEV_RUNTIME_VERSION } from "./version.ts";
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
    const transport: RuntimeSessionTransport = {
      send(message) {
        Effect.runFork(write(message).pipe(Effect.ignore));
      },
      close(code, reason) {
        Effect.runFork(write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore));
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
        const unsupported = unsupportedSessionRequirements(message, run.operationDefinition);
        if (unsupported.length > 0) {
          failRun(
            run,
            new RuntimeHostRequestError({
              message: `Host does not support required ${unsupported.join(", ")}`,
            }),
            state.store,
          );
          acknowledged = true;
          sendBacklog();
          return;
        }
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
      engineVersion: FDEV_ENGINE_VERSION,
      runtimeVersion: FDEV_RUNTIME_VERSION,
      protocolHash: RUNTIME_PROTOCOL_HASH,
    },
    operation: {
      id: run.operation,
      requiredHostCapabilities: run.operationDefinition?.requiredHostCapabilities ?? [],
      requiredHostMethods: run.operationDefinition?.requiredHostMethods ?? [],
    },
  }));
}

function unsupportedSessionRequirements(message: SessionMessage, operation: RuntimeOperation | undefined): string[] {
  const unsupported: string[] = [];
  for (const requirement of operation?.requiredHostMethods ?? []) {
    const hostMethod = sessionItems(message.hostMethods).find((item) => item.id === requirement.id);
    if (!hostMethod || !supportsModes(hostMethod.modes, requirement.modes)) {
      unsupported.push(`host method ${formatRequirement(requirement.id, requirement.modes)}`);
    }
  }
  for (const requirement of operation?.requiredHostCapabilities ?? []) {
    const capability = sessionItems(message.hostCapabilities).find((item) => item.id === requirement.id);
    if (!capability || (requirement.schemaHash && capability.schemaHash !== requirement.schemaHash)) {
      unsupported.push(requirement.schemaHash
        ? `host capability ${requirement.id}@${requirement.schemaHash}`
        : `host capability ${requirement.id}`);
    }
  }
  return unsupported;
}

function sessionItems(value: unknown): Array<{ id: string; modes?: string[]; schemaHash?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [{
      id: item.id,
      modes: Array.isArray(item.modes) ? item.modes.filter((mode): mode is string => typeof mode === "string") : undefined,
      schemaHash: typeof item.schemaHash === "string" ? item.schemaHash : undefined,
    }];
  });
}

function supportsModes(hostModes: string[] | undefined, requiredModes: string[] | undefined): boolean {
  if (!requiredModes?.length) return true;
  const supported = new Set(hostModes ?? []);
  return requiredModes.every((mode) => supported.has(mode));
}

function formatRequirement(id: string, modes: string[] | undefined): string {
  return modes?.length ? `${id}:${modes.join("|")}` : id;
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
