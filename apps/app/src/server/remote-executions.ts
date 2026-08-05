import { createHash } from "node:crypto";
import type {
  ManagedProject,
  ManagedRun,
  RemoteExecutionRequest,
  RemoteExecutionResponse,
} from "@stoke/managed";
import { registerCheckout, registerDevice } from "./devices.ts";
import { getProject } from "./projects.ts";
import { accountRepository } from "./repositories/account-repository.ts";
import { getProjectState, updateProjectState } from "./project-state.ts";
import { createRunSocketUrl } from "./run-tickets.ts";
import {
  runRemoteSandbox,
  type RemoteSandboxResult,
  type RunRemoteSandboxInput,
} from "./remote-sandbox.ts";
import { appendRunEvent, claimRun, getRun, heartbeatRun } from "./runs.ts";

const CLOUD_DEVICE_NAME = "Vercel Sandbox";
const JOIN_POLL_MS = 500;
const JOIN_TIMEOUT_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export type RemoteExecutionDependencies = {
  getProject: typeof getProject;
  registerDevice: typeof registerDevice;
  registerCheckout: typeof registerCheckout;
  claimRun: typeof claimRun;
  getRun: typeof getRun;
  appendRunEvent: typeof appendRunEvent;
  heartbeatRun: typeof heartbeatRun;
  getProjectState: typeof getProjectState;
  updateProjectState: typeof updateProjectState;
  findGitHubAccessToken: typeof accountRepository.findGitHubAccessToken;
  runSandbox: (input: RunRemoteSandboxInput) => Promise<RemoteSandboxResult>;
};

const defaultDependencies: RemoteExecutionDependencies = {
  getProject,
  registerDevice,
  registerCheckout,
  claimRun,
  getRun,
  appendRunEvent,
  heartbeatRun,
  getProjectState,
  updateProjectState,
  findGitHubAccessToken: accountRepository.findGitHubAccessToken,
  runSandbox: runRemoteSandbox,
};

export async function executeRemoteProject(
  userId: string,
  projectId: string,
  request: RemoteExecutionRequest,
  overrides: Partial<RemoteExecutionDependencies> = {},
): Promise<RemoteExecutionResponse> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const project = await dependencies.getProject(userId, projectId);
  if (!project) throw new Error("Managed project was not found");
  if (project.source.kind !== "github") {
    throw new Error("Remote execution currently requires a GitHub project source");
  }

  const deviceId = cloudDeviceId(userId);
  await dependencies.registerDevice(userId, { id: deviceId, name: CLOUD_DEVICE_NAME });
  const checkout = await dependencies.registerCheckout(userId, {
    projectId: project.id,
    deviceId,
    path: `vercel-sandbox://${project.id}`,
    gitRemote: `https://github.com/${project.source.owner}/${project.source.repository}.git`,
    relink: true,
  });
  const claimed = await dependencies.claimRun(userId, {
    projectId: project.id,
    checkoutId: checkout.id,
    operation: request.operation,
    workflow: request.workflow ?? "default",
    fingerprint: remoteExecutionFingerprint(project, request),
  });

  if (claimed.disposition === "joined") {
    return {
      run: await waitForRun(userId, claimed.run, dependencies.getRun),
      disposition: "joined",
    };
  }

  try {
    const githubToken = await dependencies.findGitHubAccessToken(userId);
    const projectState = await dependencies.getProjectState(userId, project.id);
    const heartbeat = setInterval(() => {
      void dependencies.heartbeatRun(userId, claimed.run.id).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    let result: unknown;
    try {
      const executed = await dependencies.runSandbox({
        project,
        request,
        state: projectState,
        producerSocketUrl: createRunSocketUrl(controlPlaneUrl(), {
          runId: claimed.run.id,
          userId,
          role: "producer",
        }),
        githubToken,
        onStage: async (stage) => {
          await dependencies.appendRunEvent(userId, claimed.run.id, stage);
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
    const observed = await dependencies.getRun(userId, claimed.run.id);
    if (observed.nodeCount === undefined) {
      await appendResultEvents(userId, claimed.run.id, request, result, dependencies.appendRunEvent);
    }
    await dependencies.appendRunEvent(userId, claimed.run.id, { type: "run.completed" });
    return {
      run: await dependencies.getRun(userId, claimed.run.id),
      disposition: "created",
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dependencies.appendRunEvent(userId, claimed.run.id, {
      type: "run.failed",
      error: { message },
    });
    throw new RemoteExecutionError(message, await dependencies.getRun(userId, claimed.run.id));
  }
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

function cloudDeviceId(userId: string): string {
  return `vercel-sandbox:${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
}

function remoteExecutionFingerprint(project: ManagedProject, request: RemoteExecutionRequest): string {
  return `remote:${createHash("sha256")
    .update(JSON.stringify({ projectId: project.id, updatedAt: project.updatedAt, request }))
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
