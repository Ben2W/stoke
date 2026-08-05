import { createHash } from "node:crypto";
import type {
  ManagedProject,
  ManagedRun,
  RemoteExecutionRequest,
  RemoteExecutionResponse,
} from "@stoke/managed";
import { getProject } from "./projects.ts";
import { resolvePublicGitHubRevision } from "./github-repository.ts";
import { getProjectState, updateProjectState } from "./project-state.ts";
import { createRunSocketUrl } from "./run-tickets.ts";
import {
  runRemoteSandbox,
  type RemoteSandboxResult,
  type RunRemoteSandboxInput,
} from "./remote-sandbox.ts";
import { appendRunEvent, claimRemoteRun, getRun, heartbeatRun } from "./runs.ts";

const JOIN_POLL_MS = 500;
const JOIN_TIMEOUT_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export type RemoteExecutionDependencies = {
  getProject: typeof getProject;
  claimRemoteRun: typeof claimRemoteRun;
  getRun: typeof getRun;
  appendRunEvent: typeof appendRunEvent;
  heartbeatRun: typeof heartbeatRun;
  getProjectState: typeof getProjectState;
  updateProjectState: typeof updateProjectState;
  resolveGitHubRevision: typeof resolvePublicGitHubRevision;
  runSandbox: (input: RunRemoteSandboxInput) => Promise<RemoteSandboxResult>;
};

export type StartedRemoteExecution = {
  run: ManagedRun;
  disposition: "created" | "joined";
  completion?: Promise<RemoteExecutionResponse>;
};

const defaultDependencies: RemoteExecutionDependencies = {
  getProject,
  claimRemoteRun,
  getRun,
  appendRunEvent,
  heartbeatRun,
  getProjectState,
  updateProjectState,
  resolveGitHubRevision: resolvePublicGitHubRevision,
  runSandbox: runRemoteSandbox,
};

export async function executeRemoteProject(
  userId: string,
  projectId: string,
  request: RemoteExecutionRequest,
  overrides: Partial<RemoteExecutionDependencies> = {},
): Promise<RemoteExecutionResponse> {
  const started = await startRemoteProjectExecution(userId, projectId, request, overrides);
  if (started.disposition === "joined") {
    const dependencies = { ...defaultDependencies, ...overrides };
    return {
      run: await waitForRun(userId, started.run, dependencies.getRun),
      disposition: "joined",
    };
  }
  if (!started.completion) throw new Error("Remote execution did not start");
  return await started.completion;
}

export async function startRemoteProjectExecution(
  userId: string,
  projectId: string,
  request: RemoteExecutionRequest,
  overrides: Partial<RemoteExecutionDependencies> = {},
): Promise<StartedRemoteExecution> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const project = await dependencies.getProject(userId, projectId);
  if (!project) throw new Error("Managed project was not found");
  if (project.source.kind !== "github") {
    throw new Error("Remote execution currently requires a GitHub project source");
  }

  const revision = await dependencies.resolveGitHubRevision(project.source);
  const claimed = await dependencies.claimRemoteRun(userId, {
    projectId: project.id,
    operation: request.operation,
    workflow: request.workflow ?? "default",
    fingerprint: remoteExecutionFingerprint(project, request, revision),
    origin: request.origin,
  });

  if (claimed.disposition === "joined") {
    return { run: claimed.run, disposition: "joined" };
  }

  return {
    run: claimed.run,
    disposition: "created",
    completion: completeRemoteProjectExecution(
      userId,
      project,
      request,
      revision,
      claimed.run,
      dependencies,
    ),
  };
}

async function completeRemoteProjectExecution(
  userId: string,
  project: ManagedProject,
  request: RemoteExecutionRequest,
  revision: string,
  run: ManagedRun,
  dependencies: RemoteExecutionDependencies,
): Promise<RemoteExecutionResponse> {
  try {
    const projectState = await dependencies.getProjectState(userId, project.id);
    const heartbeat = setInterval(() => {
      void dependencies.heartbeatRun(userId, run.id).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    let result: unknown;
    try {
      const executed = await dependencies.runSandbox({
        project,
        request,
        state: projectState,
        producerSocketUrl: createRunSocketUrl(controlPlaneUrl(), {
          runId: run.id,
          userId,
          role: "producer",
        }),
        revision,
        onStage: async (stage) => {
          await dependencies.appendRunEvent(userId, run.id, stage);
        },
      });
      result = executed.result;
      await dependencies.updateProjectState(userId, project.id, {
        expectedRevision: projectState.revision,
        snapshot: executed.state.snapshot,
      });
    } finally {
      clearInterval(heartbeat);
    }
    await appendPlanNodes(userId, run.id, result, dependencies.appendRunEvent);
    const observed = await dependencies.getRun(userId, run.id);
    if (observed.nodeCount === undefined) {
      await appendResultEvents(userId, run.id, request, result, dependencies.appendRunEvent);
    }
    await dependencies.appendRunEvent(userId, run.id, { type: "run.completed" });
    return {
      run: await dependencies.getRun(userId, run.id),
      disposition: "created",
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dependencies.appendRunEvent(userId, run.id, {
      type: "run.failed",
      error: { message },
    });
    throw new RemoteExecutionError(message, await dependencies.getRun(userId, run.id));
  }
}

async function appendPlanNodes(
  userId: string,
  runId: string,
  result: unknown,
  append: typeof appendRunEvent,
): Promise<void> {
  const plan = resultPlan(result);
  if (!plan) return;
  await append(userId, runId, {
    type: "plan.nodes",
    workflow: plan.workflow,
    nodes: plan.nodes,
  });
}

function controlPlaneUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "https://usestoke.dev";
}

export class RemoteExecutionError extends Error {
  override name = "RemoteExecutionError";

  constructor(message: string, readonly run: ManagedRun) {
    super(message);
  }
}

function remoteExecutionFingerprint(
  project: ManagedProject,
  request: RemoteExecutionRequest,
  revision: string,
): string {
  return `remote:${createHash("sha256")
    .update(JSON.stringify({
      projectId: project.id,
      revision,
      operation: request.operation,
      workflow: request.workflow,
      ...(request.operation === "apply" ? { dryRun: request.dryRun } : {}),
    }))
    .digest("hex")}`;
}

async function appendResultEvents(
  userId: string,
  runId: string,
  request: RemoteExecutionRequest,
  result: unknown,
  append: typeof appendRunEvent,
): Promise<void> {
  const summary = resultSummary(result);
  if (!summary) return;
  await append(userId, runId, {
    type: request.operation === "plan" ? "plan.created" : "workflow.apply.completed",
    workflow: summary.workflow,
    nodeCount: summary.nodeCount,
    cachedNodeCount: summary.cachedNodeCount,
  });
}

function resultSummary(result: unknown): {
  workflow: string;
  nodeCount: number;
  cachedNodeCount: number;
} | undefined {
  if (!isRecord(result)) return undefined;
  const value = isRecord(result.plan) ? result.plan : result;
  if (
    typeof value.workflow !== "string"
    || typeof value.nodeCount !== "number"
    || typeof value.cachedNodeCount !== "number"
  ) return undefined;
  return {
    workflow: value.workflow,
    nodeCount: value.nodeCount,
    cachedNodeCount: value.cachedNodeCount,
  };
}

function resultPlan(result: unknown): {
  workflow: string;
  nodes: Array<{
    index: number;
    path: string;
    name: string;
    status: "cached" | "pending";
    reason?: string;
    runId?: string;
    upstreamRunIds: string[];
  }>;
} | undefined {
  if (!isRecord(result)) return undefined;
  const value = isRecord(result.plan) ? result.plan : result;
  if (typeof value.workflow !== "string" || !Array.isArray(value.nodes)) return undefined;
  const nodes = value.nodes.flatMap((node) => {
    if (!isRecord(node) || typeof node.index !== "number" || typeof node.path !== "string"
      || typeof node.name !== "string" || (node.status !== "cached" && node.status !== "pending")
      || !Array.isArray(node.upstreamRunIds) || !node.upstreamRunIds.every((id) => typeof id === "string")) return [];
    const status: "cached" | "pending" = node.status;
    return [{
      index: node.index,
      path: node.path,
      name: node.name,
      status,
      ...(typeof node.reason === "string" ? { reason: node.reason } : {}),
      ...(typeof node.runId === "string" ? { runId: node.runId } : {}),
      upstreamRunIds: node.upstreamRunIds,
    }];
  });
  return { workflow: value.workflow, nodes };
}

async function waitForRun(
  userId: string,
  run: ManagedRun,
  read: typeof getRun,
): Promise<ManagedRun> {
  const deadline = Date.now() + JOIN_TIMEOUT_MS;
  let current = run;
  while (current.status === "running" && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, JOIN_POLL_MS));
    current = await read(userId, run.id);
  }
  if (current.status === "running") throw new Error("Timed out waiting for the active remote execution");
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
