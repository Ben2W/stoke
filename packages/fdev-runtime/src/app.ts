import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { FDEV_ENGINE_VERSION } from "@freestyle-sh/fdev-engine";
import { ZodError } from "zod";
import { FDEV_RUNTIME_VERSION } from "./version.ts";
import { openApiDocument } from "./openapi.ts";
import { errorBody, parseJson, unauthorized } from "./http.ts";
import {
  HostResponseSchema,
  RUNTIME_API_VERSION,
  RUNTIME_PROTOCOL_HASH,
  RunOperationRequestSchema,
} from "./protocol.ts";
import { loadEngine, operationsFor, runOperation } from "./operations.ts";
import {
  createRun,
  sseResponse,
  summarizeRun,
  type RunStore,
} from "./runs.ts";
import type { RuntimeContext } from "./types.ts";

export type RuntimeAppState = {
  readonly context: RuntimeContext;
  readonly store: RunStore;
};

export function createRuntimeApp(context: RuntimeContext, store: RunStore) {
  const state: RuntimeAppState = {
    context,
    store,
  };
  const app = new Hono<{ Variables: { state: RuntimeAppState } }>();

  app.use("*", async (c, next) => {
    c.set("state", state);
    c.header("x-fdev-api-version", String(RUNTIME_API_VERSION));
    c.header("x-fdev-protocol-hash", RUNTIME_PROTOCOL_HASH);
    c.header("x-fdev-engine-version", FDEV_ENGINE_VERSION);
    c.header("x-fdev-runtime-version", FDEV_RUNTIME_VERSION);
    if (c.req.path !== "/health") {
      const authorization = c.req.header("authorization") ?? "";
      if (authorization !== `Bearer ${context.token}`) unauthorized();
    }
    context.touch();
    await next();
  });

  app.get("/health", (c) => c.json({
    ok: true,
    projectId: context.projectId,
    projectDir: context.projectDir,
    configPath: context.configPath,
    engineVersion: FDEV_ENGINE_VERSION,
    runtimeVersion: FDEV_RUNTIME_VERSION,
    expiresAt: context.getExpiresAt(),
  }));

  app.get("/runtime", (c) => c.json({
    apiVersion: RUNTIME_API_VERSION,
    engineVersion: FDEV_ENGINE_VERSION,
    runtimeVersion: FDEV_RUNTIME_VERSION,
    protocolHash: RUNTIME_PROTOCOL_HASH,
  }));

  app.get("/openapi.json", (c) => c.json(openApiDocument()));

  app.get("/project", async (c) => {
    const engine = await loadEngine(context);
    return c.json(engine.getProjectInfo());
  });

  app.get("/operations", async (c) => {
    const engine = await loadEngine(context);
    return c.json({ operations: operationsFor(engine) });
  });

  app.get("/workflows", async (c) => {
    const engine = await loadEngine(context);
    const info = engine.getProjectInfo();
    return c.json({ workflows: info.workflow ? [info.workflow] : [] });
  });

  app.get("/workspaces", async (c) => {
    const engine = await loadEngine(context);
    return c.json({ workspaces: engine.listWorkspaces() });
  });

  app.get("/snapshots", async (c) => {
    const engine = await loadEngine(context);
    return c.json({ snapshots: engine.listSnapshots() });
  });

  app.get("/runs", (c) => c.json({
    runs: [...state.store.runs.values()].map((run) => summarizeRun(run)),
  }));

  app.post("/runs", async (c) => {
    const body = RunOperationRequestSchema.parse(await parseJson(c.req.raw));
    const run = createRun(body.operation, body.input ?? {});
    state.store.runs.set(run.id, run);
    runOperation(run, state.store, context);
    return c.json({
      runId: run.id,
      operation: run.operation,
      status: run.status,
      eventsUrl: `/runs/${run.id}/events`,
    }, 202);
  });

  app.get("/runs/:runId", (c) => {
    const run = state.store.runs.get(c.req.param("runId"));
    if (!run) throw new HTTPException(404, { message: `Unknown run ${c.req.param("runId")}` });
    return c.json(summarizeRun(run));
  });

  app.get("/runs/:runId/events", (c) => {
    const run = state.store.runs.get(c.req.param("runId"));
    if (!run) throw new HTTPException(404, { message: `Unknown run ${c.req.param("runId")}` });
    return sseResponse(run);
  });

  app.post("/host-responses/:requestId", async (c) => {
    const requestId = c.req.param("requestId");
    const pending = state.store.hostResponses.get(requestId);
    if (!pending) throw new HTTPException(404, { message: `Unknown host request ${requestId}` });

    state.store.hostResponses.delete(requestId);
    const body = HostResponseSchema.parse(await parseJson(c.req.raw));
    if ("error" in body) {
      pending.reject(new Error(body.error.message ?? "Host request failed"));
    } else {
      pending.resolve(body.result ?? null);
    }
    return c.json({ ok: true });
  });

  app.post("/shutdown", (c) => {
    queueMicrotask(() => context.stop());
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: { message: `No route for ${c.req.method} ${c.req.path}` } }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json(errorBody(error), error.status);
    if (error instanceof ZodError) return c.json({ error: { message: zodErrorMessage(error) } }, 400);
    return c.json(errorBody(error), 500);
  });

  return app;
}

function zodErrorMessage(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}
