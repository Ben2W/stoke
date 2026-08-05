import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import type {
  CreateManagedSandboxRequest,
  CreateManagedSandboxSnapshotRequest,
  ManagedSandbox,
  ManagedSandboxCommandResponse,
  ManagedSandboxSnapshot,
  RunManagedSandboxCommandRequest,
} from "@usestoke/managed";
import { getProject } from "./projects.ts";

type SandboxHandle = Awaited<ReturnType<typeof Sandbox.get>>;

export type ManagedSandboxDependencies = {
  getProject: typeof getProject;
  create(input: NonNullable<Parameters<typeof Sandbox.create>[0]>): Promise<SandboxHandle>;
  get(input: Parameters<typeof Sandbox.get>[0]): Promise<SandboxHandle>;
};

const defaultDependencies: ManagedSandboxDependencies = {
  getProject,
  create: (input) => Sandbox.create(input),
  get: (input) => Sandbox.get(input),
};

export class ManagedSandboxNotFoundError extends Error {
  override name = "ManagedSandboxNotFoundError";
}

export async function createManagedSandbox(
  userId: string,
  input: CreateManagedSandboxRequest,
  overrides: Partial<ManagedSandboxDependencies> = {},
): Promise<ManagedSandbox> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const project = await dependencies.getProject(userId, input.projectId);
  if (!project) throw new ManagedSandboxNotFoundError("Stoke project not found");

  const sandbox = await dependencies.create({
    ...(input.source.type === "snapshot"
      ? { source: { type: "snapshot" as const, snapshotId: input.source.snapshotId } }
      : { runtime: input.runtime }),
    ports: input.ports,
    timeout: input.timeout,
    resources: input.resources,
    persistent: true,
    tags: ownershipTags(userId, input.projectId),
  });

  return {
    name: sandbox.name,
    domains: Object.fromEntries(input.ports.map((port) => [String(port), sandbox.domain(port)])),
  };
}

export async function snapshotManagedSandbox(
  userId: string,
  sandboxName: string,
  input: CreateManagedSandboxSnapshotRequest,
  overrides: Partial<ManagedSandboxDependencies> = {},
): Promise<ManagedSandboxSnapshot> {
  const dependencies = { ...defaultDependencies, ...overrides };
  await requireProject(dependencies, userId, input.projectId);
  const sandbox = await dependencies.get({ name: sandboxName });
  requireOwnership(sandbox, userId, input.projectId);
  const snapshot = await sandbox.snapshot(
    input.expiration === undefined ? undefined : { expiration: input.expiration },
  );
  return { snapshotId: snapshot.snapshotId };
}

export async function runManagedSandboxCommand(
  userId: string,
  sandboxName: string,
  input: RunManagedSandboxCommandRequest,
  overrides: Partial<ManagedSandboxDependencies> = {},
): Promise<ManagedSandboxCommandResponse> {
  const dependencies = { ...defaultDependencies, ...overrides };
  await requireProject(dependencies, userId, input.projectId);
  const sandbox = await dependencies.get({ name: sandboxName });
  requireOwnership(sandbox, userId, input.projectId);
  const result = await sandbox.runCommand({
    cmd: input.cmd,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    detached: input.detached,
    timeoutMs: input.timeoutMs,
  });
  if (result.exitCode === null) return { exitCode: null, stdout: "", stderr: "" };
  return {
    exitCode: result.exitCode,
    stdout: await result.stdout(),
    stderr: await result.stderr(),
  };
}

export async function stopManagedSandbox(
  userId: string,
  sandboxName: string,
  projectId: string,
  overrides: Partial<ManagedSandboxDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  await requireProject(dependencies, userId, projectId);
  const sandbox = await dependencies.get({ name: sandboxName });
  requireOwnership(sandbox, userId, projectId);
  await sandbox.stop();
}

export async function openManagedSandboxInteractive(
  userId: string,
  sandboxName: string,
  projectId: string,
  overrides: Partial<ManagedSandboxDependencies> = {},
): Promise<{ url: string; token: string }> {
  const dependencies = { ...defaultDependencies, ...overrides };
  await requireProject(dependencies, userId, projectId);
  const sandbox = await dependencies.get({ name: sandboxName });
  requireOwnership(sandbox, userId, projectId);
  return await sandbox.openInteractive();
}

async function requireProject(
  dependencies: ManagedSandboxDependencies,
  userId: string,
  projectId: string,
): Promise<void> {
  if (!await dependencies.getProject(userId, projectId)) {
    throw new ManagedSandboxNotFoundError("Stoke project not found");
  }
}

function requireOwnership(sandbox: SandboxHandle, userId: string, projectId: string): void {
  const expected = ownershipTags(userId, projectId);
  if (sandbox.tags?.owner !== expected.owner || sandbox.tags?.project !== expected.project) {
    throw new ManagedSandboxNotFoundError("Vercel Sandbox not found");
  }
}

function ownershipTags(userId: string, projectId: string): Record<string, string> {
  return {
    service: "stoke",
    owner: tagValue(userId),
    project: tagValue(projectId),
  };
}

function tagValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
