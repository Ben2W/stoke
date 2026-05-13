import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  HttpApp,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { RIGKIT_ENGINE_VERSION } from "@rigkit/engine";
import { Effect, Exit, Scope } from "effect";
import { RIGKIT_RUNTIME_VERSION } from "./version.ts";
import { runtimeJsonError, sessionRunIdFor } from "./app.ts";
import { createRuntimeControlApiHandler } from "./api-handlers.ts";
import type { RuntimeAppState } from "./control.ts";
import { runSessionSocketEffect } from "./sessions.ts";
import { DEFAULT_IDLE_MS } from "./protocol.ts";
import { createRunStore } from "./runs.ts";
import { readOrCreateToken } from "./token.ts";
import type { RuntimeContext, RuntimeServer, ServeRuntimeOptions } from "./types.ts";

export class RuntimeServerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RuntimeServerError";
  }
}

export function serveRuntimeEffect(options: ServeRuntimeOptions): Effect.Effect<RuntimeServer, RuntimeServerError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () => serveRuntime(options),
      catch: (cause) => new RuntimeServerError("Failed to start Rigkit runtime server", { cause }),
    }),
    (server) => Effect.sync(() => server.stop()),
  );
}

export async function serveRuntime(options: ServeRuntimeOptions): Promise<RuntimeServer> {
  const projectDir = resolve(options.projectDir);
  const configPath = resolve(options.configPath);
  const statePath = options.statePath ? resolve(options.statePath) : undefined;
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? readOrCreateToken(options.tokenPath);
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const startedAt = new Date().toISOString();
  const store = createRunStore();
  let expiresAt = new Date(Date.now() + idleMs).toISOString();
  let url = "";
  let stopServer = () => {};
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const writeHandle = () => {
    mkdirSync(dirname(options.handlePath), { recursive: true });
    writeFileSync(
      options.handlePath,
      `${JSON.stringify({
        projectId: options.projectId,
        runtimeFingerprint: options.runtimeFingerprint,
        projectDir,
        configPath,
        statePath,
        pid: process.pid,
        url,
        tokenPath: options.tokenPath,
        engineVersion: RIGKIT_ENGINE_VERSION,
        runtimeVersion: RIGKIT_RUNTIME_VERSION,
        startedAt,
        expiresAt,
      }, null, 2)}\n`,
    );
  };

  const context: RuntimeContext = {
    projectId: options.projectId,
    runtimeFingerprint: options.runtimeFingerprint,
    projectDir,
    configPath,
    statePath,
    source: options.source,
    token,
    startedAt,
    getExpiresAt: () => expiresAt,
    touch: () => {
      expiresAt = new Date(Date.now() + idleMs).toISOString();
      if (url) writeHandle();
    },
    stop: () => stopServer(),
  };
  const state: RuntimeAppState = { context, store };
  const controlApi = createRuntimeControlApiHandler(context, store);
  const app = createRuntimeHttpApp(state, controlApi);
  const scope = Effect.runSync(Scope.make());
  const server = await Effect.runPromise(Scope.extend(BunHttpServer.make({
    hostname: host,
    port: options.port ?? 0,
  }), scope));
  await Effect.runPromise(Scope.extend(
    HttpServer.serveEffect(app).pipe(Effect.provideService(HttpServer.HttpServer, server)),
    scope,
  ));

  let stopped = false;
  stopServer = () => {
    if (stopped) return;
    stopped = true;
    if (idleTimer) clearInterval(idleTimer);
    void controlApi.dispose();
    void Effect.runPromise(Scope.close(scope, Exit.void))
      .catch(() => {})
      .finally(resolveClosed);
  };

  const port = server.address._tag === "TcpAddress" ? server.address.port : options.port ?? 0;
  url = `http://${host}:${port}`;
  writeHandle();

  idleTimer = setInterval(() => {
    if ([...store.runs.values()].some((run) => run.status === "running") || store.activeSessions > 0) return;
    if (Date.now() <= Date.parse(expiresAt)) return;
    stopServer();
  }, Math.min(idleMs, 30_000));
  idleTimer.unref?.();

  return {
    url,
    token,
    closed,
    stop() {
      stopServer();
    },
  };
}

function createRuntimeHttpApp(
  state: RuntimeAppState,
  controlApi: ReturnType<typeof createRuntimeControlApiHandler>,
): HttpApp.Default<unknown> {
  const controlApp = HttpApp.fromWebHandler(controlApi.handler);
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const sessionRunId = sessionRunIdFor(requestPathname(request.url));
    if (sessionRunId) return yield* handleRunSessionRequest(state, sessionRunId);
    return yield* controlApp;
  });
}

function handleRunSessionRequest(
  state: RuntimeAppState,
  runId: string,
) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers.authorization !== `Bearer ${state.context.token}`) {
      return HttpServerResponse.fromWeb(runtimeJsonError(401, "Unauthorized"));
    }

    if (!state.store.runs.has(runId)) {
      return HttpServerResponse.fromWeb(runtimeJsonError(404, `Unknown run ${runId}`));
    }

    state.context.touch();
    const socket = yield* Effect.either(HttpServerRequest.upgrade);
    if (socket._tag === "Left") {
      return HttpServerResponse.fromWeb(runtimeJsonError(400, "WebSocket upgrade failed"));
    }

    yield* Effect.forkDaemon(
      runSessionSocketEffect(state, runId, socket.right).pipe(Effect.scoped),
    );
    return HttpServerResponse.empty({ status: 101 });
  });
}

function requestPathname(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return new URL(url).pathname;
  return url.split("?", 1)[0] || "/";
}

export type { RuntimeServer, ServeRuntimeOptions } from "./types.ts";
