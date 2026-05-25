import {
  FetchHttpClient,
  Headers,
  HttpApiClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Cause, Effect, Exit, Option } from "effect";
import {
  RuntimeAuthError,
  RuntimeConnectionError,
  RuntimeHttpError,
  RuntimeProtocolError,
  isRuntimeClientError,
  type RuntimeClientError,
} from "./errors.ts";
import { assertSupportedApiVersionHeader, toRuntimeTransportError } from "./http.ts";
import { RuntimeErrorResponseSchema } from "./schemas.ts";
import {
  runtimeControlApi,
  type RuntimeControlHealth,
  type RuntimeControlHostResponse,
  type RuntimeControlCacheExplainRequest,
  type RuntimeControlCacheExplainResponse,
  type RuntimeControlCacheRequest,
  type RuntimeControlCacheClearRequest,
  type RuntimeControlCacheClearResponse,
  type RuntimeControlCacheInvalidateRequest,
  type RuntimeControlCacheInvalidateResponse,
  type RuntimeControlCacheResponse,
  type RuntimeControlMetadata,
  type RuntimeControlOkResponse,
  type RuntimeControlOperationsManifest,
  type RuntimeControlProjectInfo,
  type RuntimeControlRun,
  type RuntimeControlRunOperationRequest,
  type RuntimeControlRunsResponse,
  type RuntimeControlRunStarted,
  type RuntimeControlSnapshotsResponse,
  type RuntimeControlWorkflowsResponse,
  type RuntimeControlWorkspacesResponse,
} from "./api.ts";

export type RuntimeHttpClientOptions = {
  readonly baseUrl: string;
  readonly token: string;
};

export type RuntimeHttpClient = {
  health(): Promise<RuntimeControlHealth>;
  openApi(): Promise<unknown>;
  runtime(): Promise<RuntimeControlMetadata>;
  project(): Promise<RuntimeControlProjectInfo>;
  operations(): Promise<RuntimeControlOperationsManifest>;
  workflows(): Promise<RuntimeControlWorkflowsResponse>;
  workspaces(): Promise<RuntimeControlWorkspacesResponse>;
  snapshots(): Promise<RuntimeControlSnapshotsResponse>;
  cache(body?: RuntimeControlCacheRequest): Promise<RuntimeControlCacheResponse>;
  explainCache(body: RuntimeControlCacheExplainRequest): Promise<RuntimeControlCacheExplainResponse>;
  clearCache(body: RuntimeControlCacheClearRequest): Promise<RuntimeControlCacheClearResponse>;
  invalidateCache(body: RuntimeControlCacheInvalidateRequest): Promise<RuntimeControlCacheInvalidateResponse>;
  runs(): Promise<RuntimeControlRunsResponse>;
  startRun(body: RuntimeControlRunOperationRequest): Promise<RuntimeControlRunStarted>;
  run(runId: string): Promise<RuntimeControlRun>;
  hostResponse(requestId: string, body: RuntimeControlHostResponse): Promise<RuntimeControlOkResponse>;
  shutdown(): Promise<RuntimeControlOkResponse>;
};

type RuntimeControlApiClient = Effect.Effect.Success<ReturnType<typeof runtimeControlApiClientEffect>>;
type RuntimeHttpResponse<A> = [A, HttpClientResponse.HttpClientResponse];
type RuntimeHttpContext = {
  readonly method: string;
  readonly path: string;
};

export function runtimeHttpClientEffect(
  options: RuntimeHttpClientOptions,
): Effect.Effect<RuntimeHttpClient, RuntimeClientError> {
  return Effect.succeed(createRuntimeHttpClient(options));
}

export function createRuntimeHttpClient(options: RuntimeHttpClientOptions): RuntimeHttpClient {
  return makeRuntimeHttpClient({
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    token: options.token,
  });
}

function runtimeControlApiClientEffect(options: RuntimeHttpClientOptions) {
  return HttpApiClient.make(runtimeControlApi, {
    baseUrl: options.baseUrl,
    transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(options.token)),
  });
}

function makeRuntimeHttpClient(options: RuntimeHttpClientOptions): RuntimeHttpClient {
  return {
    health: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.health({ withResponse: true })), {
        method: "GET",
        path: "/health",
      }),
    openApi: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.openApi({ withResponse: true })), {
        method: "GET",
        path: "/openapi.json",
      }),
    runtime: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.runtime({ withResponse: true })), {
        method: "GET",
        path: "/runtime",
      }),
    project: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.project({ withResponse: true })), {
        method: "GET",
        path: "/project",
      }),
    operations: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.operations({ withResponse: true })), {
        method: "GET",
        path: "/operations",
      }),
    workflows: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.workflows({ withResponse: true })), {
        method: "GET",
        path: "/workflows",
      }),
    workspaces: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.workspaces({ withResponse: true })), {
        method: "GET",
        path: "/workspaces",
      }),
    snapshots: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.snapshots({ withResponse: true })), {
        method: "GET",
        path: "/snapshots",
      }),
    cache: (body) =>
      body
        ? runRuntimeHttpRequest(
          withRuntimeControlClient(options, (client) => client.listCache({ payload: body, withResponse: true })),
          { method: "POST", path: "/cache/list" },
        )
        : runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.cache({ withResponse: true })), {
          method: "GET",
          path: "/cache",
        }),
    explainCache: (body) =>
      runRuntimeHttpRequest(
        withRuntimeControlClient(options, (client) => client.explainCache({ payload: body, withResponse: true })),
        { method: "POST", path: "/cache/explain" },
      ),
    clearCache: (body) =>
      runRuntimeHttpRequest(
        withRuntimeControlClient(options, (client) => client.clearCache({ payload: body, withResponse: true })),
        { method: "POST", path: "/cache/clear" },
      ),
    invalidateCache: (body) =>
      runRuntimeHttpRequest(
        withRuntimeControlClient(options, (client) => client.invalidateCache({ payload: body, withResponse: true })),
        { method: "POST", path: "/cache/invalidate" },
      ),
    runs: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.runs({ withResponse: true })), {
        method: "GET",
        path: "/runs",
      }),
    startRun: (body) =>
      runRuntimeHttpRequest(
        withRuntimeControlClient(options, (client) => client.startRun({ payload: body, withResponse: true })),
        { method: "POST", path: "/runs" },
      ),
    run: (runId) =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.run({ path: { runId }, withResponse: true })), {
        method: "GET",
        path: `/runs/${encodeURIComponent(runId)}`,
      }),
    hostResponse: (requestId, body) => {
      const path = `/host-responses/${encodeURIComponent(requestId)}`;
      if ("error" in body) {
        return runRuntimeHttpRequest(
          withRuntimeControlClient(options, (client) =>
            client.hostResponse({ path: { requestId }, payload: { error: body.error }, withResponse: true })
          ),
          { method: "POST", path },
        );
      }
      return runRuntimeHttpRequest(
        withRuntimeControlClient(options, (client) =>
          client.hostResponse({ path: { requestId }, payload: { result: body.result }, withResponse: true })
        ),
        { method: "POST", path },
      );
    },
    shutdown: () =>
      runRuntimeHttpRequest(withRuntimeControlClient(options, (client) => client.shutdown({ withResponse: true })), {
        method: "POST",
        path: "/shutdown",
      }),
  };
}

function withRuntimeControlClient<A>(
  options: RuntimeHttpClientOptions,
  run: (client: RuntimeControlApiClient) => Effect.Effect<RuntimeHttpResponse<A>, unknown, never>,
) {
  return Effect.flatMap(
    Effect.provide(runtimeControlApiClientEffect(options), FetchHttpClient.layer),
    run,
  );
}

async function runRuntimeHttpRequest<A>(
  program: Effect.Effect<RuntimeHttpResponse<A>, unknown, never>,
  context: RuntimeHttpContext,
): Promise<A> {
  const response = await runRuntimeHttpEffect(program, context);
  const [value, httpResponse] = response;
  try {
    assertSupportedApiVersionHeader(Option.getOrNull(Headers.get(httpResponse.headers, "x-rigkit-api-version")));
  } catch (error) {
    throw toRuntimeTransportError(error, context);
  }
  return value;
}

async function runRuntimeHttpEffect<A>(
  program: Effect.Effect<A, unknown, never>,
  context: RuntimeHttpContext,
): Promise<A> {
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw await runtimeHttpClientError(Cause.squash(exit.cause), context);
}

async function runtimeHttpClientError(cause: unknown, context: RuntimeHttpContext): Promise<RuntimeClientError> {
  if (isRuntimeClientError(cause)) return cause;
  if (cause instanceof HttpClientError.ResponseError) {
    const status = cause.response.status;
    const message = await responseErrorMessage(cause);
    if (status === 401 || status === 403) {
      return new RuntimeAuthError({ ...context, status, message });
    }
    if (status >= 200 && status < 300) {
      return new RuntimeProtocolError({
        ...context,
        message: `${context.method} ${context.path} returned invalid response`,
        cause,
      });
    }
    return new RuntimeHttpError({ ...context, status, message, cause });
  }
  if (cause instanceof HttpClientError.RequestError) {
    return new RuntimeConnectionError({ ...context, cause });
  }
  return new RuntimeProtocolError({
    ...context,
    message: `${context.method} ${context.path} returned invalid response`,
    cause,
  });
}

async function responseErrorMessage(error: HttpClientError.ResponseError): Promise<string | undefined> {
  try {
    const text = await Effect.runPromise(error.response.text);
    if (!text) return undefined;
    const parsed = JSON.parse(text);
    const body = RuntimeErrorResponseSchema.safeParse(parsed);
    return body.success ? body.data.error.message : undefined;
  } catch {
    return undefined;
  }
}
