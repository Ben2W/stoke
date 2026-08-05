import {
  HttpApiBuilder,
  HttpApp,
  HttpServer,
  HttpServerResponse,
  type HttpServerRequest,
} from "@effect/platform";
import { Cause, Context, Effect, Layer } from "effect";
import { RIGKIT_ENGINE_VERSION } from "@stoke/engine";
import { RIGKIT_RUNTIME_VERSION } from "./version.ts";
import { runtimeControlApi } from "./api.ts";
import {
  RUNTIME_API_VERSION,
  RUNTIME_PROTOCOL_HASH,
} from "./protocol.ts";
import { openApiDocument } from "./openapi.ts";
import {
  runtimeControlErrorStatus,
  runtimeHealth,
  runtimeMetadata,
  runtimeOperations,
  runtimeProject,
  runtimeRun,
  runtimeRunEvents,
  runtimeRuns,
  runtimeSnapshots,
  runtimeWorkflows,
  runtimeWorkspaces,
  shutdownRuntime,
  startRuntimeRun,
  submitHostResponse,
  explainRuntimeCache,
  listRuntimeCache,
  runtimeCache,
  clearRuntimeCache,
  invalidateRuntimeCache,
  type RuntimeAppState,
} from "./control.ts";
import type { RunStore } from "./runs.ts";
import type { RuntimeContext } from "./types.ts";

export class RuntimeApiState extends Context.Tag("rigkit/RuntimeApiState")<
  RuntimeApiState,
  RuntimeAppState
>() {}

export function runtimeApiStateLayer(context: RuntimeContext, store: RunStore) {
  return Layer.succeed(RuntimeApiState, { context, store });
}

export const runtimeControlApiHandlersLayer = HttpApiBuilder.group(
  runtimeControlApi,
  "control",
  (handlers) =>
    handlers
      .handle("health", (request) =>
        handleControlRequest(request, (state) => runtimeHealth(state.context), { public: true }))
      .handle("openApi", (request) => handleControlRequest(request, () => openApiDocument()))
      .handle("runtime", (request) => handleControlRequest(request, () => runtimeMetadata()))
      .handle("project", (request) => handleControlRequest(request, (state) => runtimeProject(state.context)))
      .handle("operations", (request) => handleControlRequest(request, (state) => runtimeOperations(state.context)))
      .handle("workflows", (request) => handleControlRequest(request, (state) => runtimeWorkflows(state.context)))
      .handle("workspaces", (request) => handleControlRequest(request, (state) => runtimeWorkspaces(state.context)))
      .handle("snapshots", (request) => handleControlRequest(request, (state) => runtimeSnapshots(state.context)))
      .handle("cache", (request) => handleControlRequest(request, (state) => runtimeCache(state.context)))
      .handle("listCache", (request) =>
        handleControlRequest(request, (state) => listRuntimeCache(state.context, request.payload)))
      .handle("explainCache", (request) =>
        handleControlRequest(request, (state) => explainRuntimeCache(state.context, request.payload)))
      .handle("clearCache", (request) =>
        handleControlRequest(request, (state) => clearRuntimeCache(state.context, request.payload)))
      .handle("invalidateCache", (request) =>
        handleControlRequest(request, (state) => invalidateRuntimeCache(state.context, request.payload)))
      .handle("runs", (request) => handleControlRequest(request, (state) => runtimeRuns(state.store)))
      .handle("startRun", (request) =>
        handleControlRequest(request, (state) => startRuntimeRun(state, request.payload)))
      .handle("run", (request) =>
        handleControlRequest(request, (state) => runtimeRun(state.store, request.path.runId)))
      .handle("runEvents", (request) =>
        handleControlRequest(
          request,
          (state) => HttpServerResponse.fromWeb(runtimeRunEvents(state.store, request.path.runId)),
        ))
      .handle("hostResponse", (request) =>
        handleControlRequest(
          request,
          (state) => submitHostResponse(state, request.path.requestId, request.payload),
        ))
      .handle("shutdown", (request) =>
        handleControlRequest(request, (state) => shutdownRuntime(state.context))),
);

export const runtimeControlApiErrorMiddlewareLayer = HttpApiBuilder.middleware(
  normalizeRuntimeControlErrors,
);

export function createRuntimeControlApiHandler(context: RuntimeContext, store: RunStore) {
  const runtimeApiLayer = HttpApiBuilder.api(runtimeControlApi).pipe(
    Layer.provide(runtimeControlApiHandlersLayer),
    Layer.provide(runtimeApiStateLayer(context, store)),
  );

  return HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      runtimeApiLayer,
      runtimeControlApiErrorMiddlewareLayer,
      HttpServer.layerContext,
    ),
  );
}

type ControlRequest = {
  readonly request: HttpServerRequest.HttpServerRequest;
};

type ControlOptions = {
  readonly public?: boolean;
};

function handleControlRequest<A>(
  request: ControlRequest,
  run: (state: RuntimeAppState) => A | PromiseLike<A>,
  options: ControlOptions = {},
) {
  return Effect.gen(function* () {
    const state = yield* RuntimeApiState;
    yield* appendRuntimeHeaders;
    if (!options.public && request.request.headers.authorization !== `Bearer ${state.context.token}`) {
      return jsonError(401, "Unauthorized");
    }
    state.context.touch();
    return yield* Effect.tryPromise({
      try: async () => run(state),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) => Effect.succeed(errorResponse(error))),
    );
  });
}

const appendRuntimeHeaders = HttpApp.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeaders(response, runtimeHeaders())));

function runtimeHeaders() {
  return {
    "x-rigkit-api-version": String(RUNTIME_API_VERSION),
    "x-rigkit-protocol-hash": RUNTIME_PROTOCOL_HASH,
    "x-rigkit-engine-version": RIGKIT_ENGINE_VERSION,
    "x-rigkit-runtime-version": RIGKIT_RUNTIME_VERSION,
  };
}

function errorResponse(error: unknown) {
  return jsonError(runtimeControlErrorStatus(error), error instanceof Error ? error.message : String(error));
}

function jsonError(status: number, message: string) {
  return HttpServerResponse.unsafeJson({ error: { message } }, { status });
}

function normalizeRuntimeControlErrors(app: HttpApp.Default): HttpApp.Default {
  return Effect.catchAllCause(app as HttpApp.Default<unknown>, (cause) => {
    const error = Cause.squash(cause);
    if (isHttpApiDecodeError(error)) {
      return Effect.succeed(jsonError(400, error.message));
    }
    return Effect.failCause(cause);
  }) as HttpApp.Default;
}

function isHttpApiDecodeError(error: unknown): error is { _tag: "HttpApiDecodeError"; message: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "_tag" in error &&
      error._tag === "HttpApiDecodeError" &&
      "message" in error &&
      typeof error.message === "string",
  );
}
