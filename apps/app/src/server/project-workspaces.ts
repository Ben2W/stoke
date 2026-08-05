import type { ManagedWorkspace } from "@usestoke/managed";
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
  const records = state.snapshot.scopes.project?.workspaces ?? [];

  return records.flatMap((value) => {
    const workspace = parseWorkspace(value);
    if (!workspace) return [];
    const checkout = workspace.createdFrom.kind === "checkout" && workspace.createdFrom.checkoutId
      ? byId.get(workspace.createdFrom.checkoutId)
      : undefined;
    let createdFrom: ManagedWorkspace["createdFrom"];
    if (workspace.createdFrom.kind === "dashboard") {
      createdFrom = { kind: "dashboard" };
    } else {
      if (!checkout) return [];
      createdFrom = {
        kind: "checkout",
        deviceId: checkout.deviceId,
        deviceName: checkout.deviceName,
        checkoutId: checkout.id,
        checkoutPath: checkout.path,
      };
    }
    return [{
      id: workspace.id,
      projectId,
      name: workspace.name,
      workflow: workspace.workflow,
      ...(workspace.sourceRevision ? { sourceRevision: workspace.sourceRevision } : {}),
      ...(workspace.cacheEntryIds ? { cacheEntryIds: workspace.cacheEntryIds } : {}),
      ctx: workspace.ctx,
      operations: workspace.operations,
      createdFrom,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }];
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseWorkspace(value: unknown): {
  id: string;
  name: string;
  workflow: string;
  sourceRevision?: string;
  cacheEntryIds?: string[];
  ctx: Record<string, unknown>;
  operations: ManagedWorkspace["operations"];
  createdFrom: { kind: "checkout"; deviceId: string; checkoutId?: string } | { kind: "dashboard" };
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
    || !isRecord(value.ctx)
    || !Array.isArray(value.operations)
  ) return undefined;
  const ctx = value.ctx;
  const operations = value.operations.flatMap((operation) => {
    if (!isRecord(operation) || typeof operation.id !== "string") return [];
    const requiredCapabilities = Array.isArray(operation.requiredCapabilities)
      ? operation.requiredCapabilities.flatMap((capability) =>
          isRecord(capability) && typeof capability.id === "string"
            ? [{
                id: capability.id,
                ...(typeof capability.schemaHash === "string" ? { schemaHash: capability.schemaHash } : {}),
              }]
            : []
        )
      : [];
    return [{
      id: operation.id,
      ...(typeof operation.title === "string" ? { title: operation.title } : {}),
      ...(typeof operation.description === "string" ? { description: operation.description } : {}),
      ...(isRecord(operation.inputSchema) ? { inputSchema: operation.inputSchema } : {}),
      requiredCapabilities,
    }];
  });
  const createdFrom = isRecord(value.createdFrom) ? value.createdFrom : undefined;
  if (createdFrom?.kind !== "checkout" && createdFrom?.kind !== "dashboard") return undefined;
  if (createdFrom.kind === "checkout" && (typeof createdFrom.deviceId !== "string" || !createdFrom.deviceId)) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    workflow: value.workflow,
    ...(typeof value.sourceRevision === "string" && /^[a-f0-9]{40}$/i.test(value.sourceRevision)
      ? { sourceRevision: value.sourceRevision }
      : {}),
    ...(Array.isArray(value.cacheEntryIds) && value.cacheEntryIds.every((id) => typeof id === "string")
      ? { cacheEntryIds: [...value.cacheEntryIds] as string[] }
      : {}),
    ctx,
    operations,
    createdFrom: createdFrom.kind === "dashboard"
      ? { kind: "dashboard" }
      : {
          kind: "checkout",
          deviceId: createdFrom.deviceId as string,
          ...(typeof createdFrom.checkoutId === "string" ? { checkoutId: createdFrom.checkoutId } : {}),
        },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
