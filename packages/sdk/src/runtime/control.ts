import { STOKE_ENGINE_VERSION, type WorkspaceRecord } from "@usestoke/engine";
import { STOKE_RUNTIME_VERSION } from "./version.ts";
import { RuntimeHostRequestError } from "./errors.ts";
import { loadEngine, operationManifestFor, runOperation } from "./operations.ts";
import {
  RUNTIME_API_VERSION,
  RUNTIME_PROTOCOL_HASH,
  RuntimeProtocolSchemaError,
  type HostResponse,
  type RunOperationRequest,
  type RuntimeOperation,
  type RuntimeOperationsManifest,
} from "./protocol.ts";
import {
  createRun,
  summarizeRun,
  sseResponse,
  type RunStore,
} from "./runs.ts";
import type { RuntimeContext } from "./types.ts";

export type RuntimeAppState = {
  readonly context: RuntimeContext;
  readonly store: RunStore;
};

export class RuntimeControlHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RuntimeControlHttpError";
  }
}

export function runtimeHealth(context: RuntimeContext) {
  return {
    ok: true,
    projectId: context.projectId,
    runtimeFingerprint: context.runtimeFingerprint,
    projectDir: context.projectDir,
    configPath: context.configPath,
    engineVersion: STOKE_ENGINE_VERSION,
    runtimeVersion: STOKE_RUNTIME_VERSION,
    expiresAt: context.getExpiresAt(),
  };
}

export function runtimeMetadata() {
  return {
    apiVersion: RUNTIME_API_VERSION,
    engineVersion: STOKE_ENGINE_VERSION,
    runtimeVersion: STOKE_RUNTIME_VERSION,
    protocolHash: RUNTIME_PROTOCOL_HASH,
  };
}

export async function runtimeProject(context: RuntimeContext) {
  const engine = await loadEngine(context);
  return engine.getProjectInfo();
}

export async function runtimeOperations(context: RuntimeContext) {
  const engine = await loadEngine(context);
  return operationManifestFor(engine);
}

export async function runtimeWorkflows(context: RuntimeContext) {
  const engine = await loadEngine(context);
  return { workflows: engine.listWorkflowSummaries() };
}

export async function runtimeWorkspaces(context: RuntimeContext) {
  const engine = await loadEngine(context);
  return { workspaces: engine.listWorkspaces().map(runtimeWorkspace) };
}

export async function runtimeSnapshots(context: RuntimeContext) {
  const engine = await loadEngine(context);
  return { snapshots: engine.listSnapshots() };
}

export async function runtimeCache(context: RuntimeContext) {
  const engine = await loadEngine(context);
  return await engine.listCache();
}

export async function listRuntimeCache(context: RuntimeContext, body: { workflow: string }) {
  const engine = await loadEngine(context);
  return await engine.listCache({ workflow: body.workflow });
}

export async function explainRuntimeCache(context: RuntimeContext, body: { workflow: string; task?: string }) {
  const engine = await loadEngine(context);
  return await engine.explainCache({
    workflow: body.workflow,
    task: body.task,
  });
}

export async function clearRuntimeCache(context: RuntimeContext, body: { workflow: string; scope?: "local" | "global" | "all" }) {
  const engine = await loadEngine(context);
  const result = await engine.clearCache({ workflow: body.workflow, scope: body.scope });
  await context.state.persist();
  return { ok: true, deleted: result.deleted };
}

export async function invalidateRuntimeCache(
  context: RuntimeContext,
  body: { workflow: string; nodePaths?: readonly string[] },
) {
  const engine = await loadEngine(context);
  const result = await engine.invalidateCache({
    workflow: body.workflow,
    nodePaths: body.nodePaths,
  });
  await context.state.persist();
  return { ok: true, invalidated: result.invalidated };
}

export function runtimeRuns(store: RunStore) {
  return {
    runs: [...store.runs.values()].map((run) => summarizeRun(run)),
  };
}

export async function startRuntimeRun(state: RuntimeAppState, body: RunOperationRequest) {
  const engine = await loadEngine(state.context);
  const manifest = operationManifestFor(engine);
  const resolved = resolveRuntimeOperation(manifest, body.operation);
  if (!resolved) throw new RuntimeControlHttpError(400, `Unknown operation ${body.operation}`);

  const run = createRun(resolved.runOperation, body.input ?? {}, resolved.operation);
  state.store.runs.set(run.id, run);
  runOperation(run, state.store, state.context);

  return {
    runId: run.id,
    operation: run.operation,
    status: run.status,
    eventsUrl: `/runs/${run.id}/events`,
    sessionUrl: `/runs/${run.id}/session`,
  };
}

export function runtimeRun(store: RunStore, runId: string) {
  const run = store.runs.get(runId);
  if (!run) throw new RuntimeControlHttpError(404, `Unknown run ${runId}`);
  return summarizeRun(run);
}

export function runtimeRunEvents(store: RunStore, runId: string): Response {
  const run = store.runs.get(runId);
  if (!run) throw new RuntimeControlHttpError(404, `Unknown run ${runId}`);
  return sseResponse(run);
}

export function submitHostResponse(state: RuntimeAppState, requestId: string, body: HostResponse) {
  const pending = state.store.hostResponses.get(requestId);
  if (!pending) throw new RuntimeControlHttpError(404, `Unknown host request ${requestId}`);

  state.store.hostResponses.delete(requestId);
  clearPendingHostRequest(state.store, requestId);
  if ("error" in body) {
    pending.reject(new RuntimeHostRequestError({
      requestId,
      hostCode: body.error.code,
      message: body.error.message ?? "Host request failed",
    }));
  } else {
    pending.resolve(body.result ?? null);
  }
  return { ok: true };
}

export function shutdownRuntime(context: RuntimeContext) {
  setTimeout(() => context.stop(), 0);
  return { ok: true };
}

export function runtimeControlErrorStatus(error: unknown): number {
  if (error instanceof RuntimeControlHttpError) return error.status;
  if (error instanceof RuntimeProtocolSchemaError) return 400;
  return 500;
}

function resolveRuntimeOperation(
  manifest: RuntimeOperationsManifest,
  requestedOperation: string,
): { operation: RuntimeOperation; runOperation: string } | undefined {
  const workspaceOperation = parseWorkspaceOperationId(requestedOperation);
  if (workspaceOperation) {
    const operation = manifest.workspaceOperations.find((item) => item.id === workspaceOperation.operation);
    return operation ? { operation, runOperation: requestedOperation } : undefined;
  }

  const operation = manifest.operations.find((operation) =>
    operation.id === requestedOperation || operation.aliases?.includes(requestedOperation)
  );
  return operation ? { operation, runOperation: operation.id } : undefined;
}

function parseWorkspaceOperationId(value: string): { workspace: string; operation: string } | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return {
    workspace: value.slice(0, slash),
    operation: value.slice(slash + 1),
  };
}

function runtimeWorkspace(workspace: WorkspaceRecord): {
  id: string;
  name: string;
  workflow: string;
  ctx: WorkspaceRecord["ctx"];
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: workspace.id,
    name: workspace.name,
    workflow: workspace.workflow,
    ctx: workspace.ctx,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export function clearPendingHostRequest(store: RunStore, requestId: string): void {
  for (const run of store.runs.values()) {
    run.pendingHostRequestIds.delete(requestId);
  }
}
