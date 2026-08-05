import { randomUUID } from "node:crypto";
import type {
  ClaimRunRequest,
  ManagedRun,
  ManagedRunEvent,
  ManagedRunOperation,
  ManagedRunOrigin,
} from "@stoke/managed";
import { runs } from "./db/schema.ts";
import {
  runRepository,
  type RunEventRow,
  type RunRow,
} from "./repositories/run-repository.ts";

const STALE_RUN_MS = 2 * 60_000;
const MAX_EVENT_DATA_LENGTH = 8_192;

export type RunClaim = {
  run: ManagedRun;
  disposition: "created" | "joined";
};

export async function claimRun(userId: string, input: ClaimRunRequest): Promise<RunClaim> {
  const scope = await runRepository.findClaimScope(userId, input.projectId, input.checkoutId);
  if (!scope) throw new Error("Managed checkout was not found");

  const now = new Date();
  const executionKey = `checkout:${input.checkoutId}`;
  await runRepository.orphanClaim({
    userId,
    projectId: input.projectId,
    executionKey,
    fingerprint: input.fingerprint,
    before: new Date(now.getTime() - STALE_RUN_MS),
    now,
  });

  const created = await runRepository.create({
    id: randomUUID(),
    userId,
    projectId: input.projectId,
    checkoutId: input.checkoutId,
    deviceId: scope.checkout.deviceId,
    origin: "machine",
    executionKey,
    operation: input.operation,
    workflow: input.workflow,
    fingerprint: input.fingerprint,
    status: "running",
    startedAt: now,
    updatedAt: now,
  });

  if (created) {
    return { run: toManagedRun(created, scope.deviceName), disposition: "created" };
  }

  const existing = await runRepository.findActive({
    userId,
    projectId: input.projectId,
    executionKey,
    fingerprint: input.fingerprint,
  });
  if (!existing) throw new Error("Could not claim or locate the active run");
  return { run: toManagedRun(existing.run, existing.deviceName), disposition: "joined" };
}

export async function claimRemoteRun(
  userId: string,
  input: {
    projectId: string;
    operation: ManagedRunOperation;
    workflow: string;
    fingerprint: string;
    origin: Exclude<ManagedRunOrigin, "machine">;
  },
): Promise<RunClaim> {
  if (!await runRepository.findProjectScope(userId, input.projectId)) {
    throw new Error("Managed project was not found");
  }

  const now = new Date();
  const executionKey = "remote";
  await runRepository.orphanClaim({
    userId,
    projectId: input.projectId,
    executionKey,
    fingerprint: input.fingerprint,
    before: new Date(now.getTime() - STALE_RUN_MS),
    now,
  });

  const created = await runRepository.create({
    id: randomUUID(),
    userId,
    projectId: input.projectId,
    origin: input.origin,
    executionKey,
    operation: input.operation,
    workflow: input.workflow,
    fingerprint: input.fingerprint,
    status: "running",
    startedAt: now,
    updatedAt: now,
  });
  if (created) return { run: toManagedRun(created, null), disposition: "created" };

  const existing = await runRepository.findActive({
    userId,
    projectId: input.projectId,
    executionKey,
    fingerprint: input.fingerprint,
  });
  if (!existing) throw new Error("Could not claim or locate the active run");
  return { run: toManagedRun(existing.run, existing.deviceName), disposition: "joined" };
}

export async function listRuns(userId: string, projectId?: string, limit = 30): Promise<ManagedRun[]> {
  await orphanStaleRuns(userId, projectId);
  const rows = await runRepository.listForUser(userId, projectId, limit);
  return rows.map(({ run, deviceName }) => toManagedRun(run, deviceName));
}

export async function getRun(userId: string, runId: string): Promise<ManagedRun> {
  const row = await runRepository.findOwnedById(userId, runId);
  if (!row) throw new Error("Managed run was not found");
  if (row.run.status === "running" && row.run.updatedAt < new Date(Date.now() - STALE_RUN_MS)) {
    const completedAt = new Date();
    await runRepository.orphanById(userId, runId, completedAt);
    return toManagedRun({
      ...row.run,
      status: "orphaned",
      completedAt,
      updatedAt: completedAt,
      error: "Executor heartbeat expired",
    }, row.deviceName);
  }
  return toManagedRun(row.run, row.deviceName);
}

export async function listRunEvents(
  userId: string,
  runId: string,
  after = 0,
): Promise<ManagedRunEvent[]> {
  await getRun(userId, runId);
  const rows = await runRepository.listEvents(runId, after);
  return rows.map(toManagedRunEvent);
}

export async function appendRunEvent(
  userId: string,
  runId: string,
  value: unknown,
): Promise<ManagedRunEvent> {
  const run = await getRun(userId, runId);
  if (run.status !== "running") throw new Error("Managed run is no longer active");
  const data = sanitizeRunEvent(value);
  const type = data.type as string;
  const now = new Date();
  const row = await runRepository.appendEvent({ runId, type, data, createdAt: now });

  const lifecycle = runUpdateForEvent(data, now);
  await runRepository.update(userId, runId, { updatedAt: now, ...lifecycle });
  return toManagedRunEvent(row);
}

export async function heartbeatRun(userId: string, runId: string): Promise<void> {
  await runRepository.heartbeat(userId, runId, new Date());
}

async function orphanStaleRuns(userId: string, projectId?: string): Promise<void> {
  const now = new Date();
  await runRepository.orphanStale(
    userId,
    new Date(now.getTime() - STALE_RUN_MS),
    now,
    projectId,
  );
}

function runUpdateForEvent(data: Record<string, unknown>, now: Date): Partial<typeof runs.$inferInsert> {
  const type = data.type;
  if (type === "workflow.apply.started" && typeof data.workflow === "string") {
    return { workflow: data.workflow };
  }
  if (type === "plan.created" || type === "workflow.apply.completed") {
    return {
      ...(typeof data.nodeCount === "number" ? { nodeCount: Math.max(0, Math.round(data.nodeCount)) } : {}),
      ...(typeof data.cachedNodeCount === "number"
        ? { cachedNodeCount: Math.max(0, Math.round(data.cachedNodeCount)) }
        : {}),
      ...(typeof data.workflow === "string" ? { workflow: data.workflow } : {}),
    };
  }
  if (type === "run.completed") return { status: "completed", completedAt: now };
  if (type === "run.failed") {
    const message = isRecord(data.error) && typeof data.error.message === "string"
      ? data.error.message.slice(0, 2_000)
      : "Runtime operation failed";
    return { status: "failed", completedAt: now, error: message };
  }
  return {};
}

function sanitizeRunEvent(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.type !== "string" || !value.type || value.type.length > 100) {
    throw new Error("Invalid managed run event");
  }
  const data = sanitizeValue(value) as Record<string, unknown>;
  if (value.type === "run.completed") return { type: "run.completed" };
  return data;
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (/token|secret|password|authorization|cookie/i.test(key)) return "[redacted]";
  if (typeof value === "string") return redactSecrets(value).slice(0, MAX_EVENT_DATA_LENGTH);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey),
      ]),
    );
  }
  return String(value ?? "");
}

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]")
    .replace(/((?:token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]");
}

function toManagedRun(row: RunRow, deviceName: string | null): ManagedRun {
  return {
    id: row.id,
    projectId: row.projectId,
    ...(row.checkoutId ? { checkoutId: row.checkoutId } : {}),
    ...(row.deviceId ? { deviceId: row.deviceId } : {}),
    ...(deviceName ? { deviceName } : {}),
    origin: row.origin,
    operation: row.operation,
    workflow: row.workflow,
    fingerprint: row.fingerprint,
    status: row.status,
    nodeCount: row.nodeCount ?? undefined,
    cachedNodeCount: row.cachedNodeCount ?? undefined,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toManagedRunEvent(row: RunEventRow): ManagedRunEvent {
  return {
    id: row.id,
    runId: row.runId,
    type: row.type,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
