import type { ManagedWorkspace } from "@stoke/managed";
import { listCheckouts } from "./devices.ts";
import { getProjectState } from "./project-state.ts";

export async function listProjectWorkspaces(
  userId: string,
  projectId: string,
): Promise<ManagedWorkspace[]> {
  const [state, allCheckouts] = await Promise.all([
    getProjectState(userId, projectId),
    listCheckouts(userId),
  ]);
  const checkouts = allCheckouts.filter((checkout) => checkout.projectId === projectId);
  const byId = new Map(checkouts.map((checkout) => [checkout.id, checkout]));
  const byDevice = new Map(checkouts.map((checkout) => [checkout.deviceId, checkout]));
  const records = state.snapshot.scopes.project?.workspaces ?? [];

  return records.flatMap((value) => {
    const workspace = parseWorkspace(value);
    if (!workspace) return [];
    const checkout = workspace.checkoutId
      ? byId.get(workspace.checkoutId)
      : workspace.deviceId ? byDevice.get(workspace.deviceId) : undefined;
    return [{
      id: workspace.id,
      projectId,
      name: workspace.name,
      workflow: workspace.workflow,
      ...(workspace.deviceId ? { deviceId: workspace.deviceId } : {}),
      ...(checkout ? {
        deviceId: checkout.deviceId,
        deviceName: checkout.deviceName,
        checkoutId: checkout.id,
        checkoutPath: checkout.path,
      } : {}),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }];
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseWorkspace(value: unknown): {
  id: string;
  name: string;
  workflow: string;
  deviceId?: string;
  checkoutId?: string;
  createdAt: string;
  updatedAt: string;
} | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.workflow !== "string"
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
  ) return undefined;
  const owner = isRecord(value.owner) ? value.owner : undefined;
  return {
    id: value.id,
    name: value.name,
    workflow: value.workflow,
    ...(typeof owner?.deviceId === "string" ? { deviceId: owner.deviceId } : {}),
    ...(typeof owner?.checkoutId === "string" ? { checkoutId: owner.checkoutId } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
