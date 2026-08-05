import { randomUUID } from "node:crypto";
import type {
  GitHubProjectSource,
  ManagedCheckout,
  ManagedDevice,
  RegisterCheckoutRequest,
  RegisterDeviceRequest,
} from "@stoke/managed";
import { checkoutRepository, type CheckoutRow } from "./repositories/checkout-repository.ts";
import { deviceRepository, type DeviceRow } from "./repositories/device-repository.ts";
import { githubSourceFromRemote, requirePublicGitHubRepository } from "./github-repository.ts";
import { projectRepository } from "./repositories/project-repository.ts";

export class ManagedResourceConflictError extends Error {
  override name = "ManagedResourceConflictError";

  constructor(
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function registerDevice(
  userId: string,
  input: RegisterDeviceRequest,
): Promise<ManagedDevice> {
  const existing = await deviceRepository.findById(input.id);
  if (existing && existing.userId !== userId) {
    throw new ManagedResourceConflictError("Device ID is already registered", { deviceId: input.id });
  }

  const now = new Date();
  const row = existing
    ? await deviceRepository.touch({ id: input.id, userId, name: input.name, now })
    : await deviceRepository.create({ id: input.id, userId, name: input.name, now });
  return toManagedDevice(row);
}

export async function listCheckouts(
  userId: string,
  deviceId?: string,
): Promise<ManagedCheckout[]> {
  const rows = await checkoutRepository.listForUser(userId, deviceId);
  return rows.map(({ checkout, deviceName }) => toManagedCheckout(checkout, deviceName));
}

export async function registerCheckout(
  userId: string,
  input: RegisterCheckoutRequest,
): Promise<ManagedCheckout> {
  const [project, device, existing] = await Promise.all([
    projectRepository.findOwnedById(userId, input.projectId),
    deviceRepository.findOwnedById(userId, input.deviceId),
    checkoutRepository.findByDevicePath(input.deviceId, input.path),
  ]);

  if (!project) throw new Error("Managed project was not found");
  if (!device) throw new Error("Device must be registered before adding a checkout");
  const githubSources = new Map<string, GitHubProjectSource>();
  if (project.source.kind === "github") {
    githubSources.set(`${project.source.owner}/${project.source.repository}`.toLowerCase(), project.source);
  }
  const upstreamSource = input.gitRemote ? githubSourceFromRemote(input.gitRemote) : undefined;
  if (upstreamSource) {
    githubSources.set(`${upstreamSource.owner}/${upstreamSource.repository}`.toLowerCase(), upstreamSource);
  }
  await Promise.all([...githubSources.values()].map((source) => requirePublicGitHubRepository(source)));
  if (existing && existing.userId !== userId) {
    throw new ManagedResourceConflictError("Checkout path is already registered", { path: input.path });
  }
  if (existing && existing.projectId !== input.projectId && !input.relink) {
    throw new ManagedResourceConflictError("Checkout belongs to another project", {
      checkoutId: existing.id,
      existingProjectId: existing.projectId,
      requestedProjectId: input.projectId,
      path: input.path,
    });
  }

  const now = new Date();
  const row = existing
    ? await checkoutRepository.relink({
        id: existing.id,
        projectId: input.projectId,
        gitRemote: input.gitRemote ?? existing.gitRemote,
        now,
      })
    : await checkoutRepository.create({
        id: randomUUID(),
        userId,
        projectId: input.projectId,
        deviceId: input.deviceId,
        path: input.path,
        gitRemote: input.gitRemote,
        now,
      });
  return toManagedCheckout(row, device.name);
}

function toManagedDevice(row: DeviceRow): ManagedDevice {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

function toManagedCheckout(
  row: CheckoutRow,
  deviceName: string,
): ManagedCheckout {
  return {
    id: row.id,
    projectId: row.projectId,
    deviceId: row.deviceId,
    deviceName,
    path: row.path,
    gitRemote: row.gitRemote,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
