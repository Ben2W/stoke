import { randomUUID } from "node:crypto";
import type {
  ClaimRunRequest,
  ManagedRun,
  ManagedRunEvent,
} from "@stoke/managed";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDatabase } from "./db/client.ts";
import {
  devices,
  projectCheckouts,
  projects,
  runEvents,
  runs,
} from "./db/schema.ts";

const STALE_RUN_MS = 2 * 60_000;
const MAX_EVENT_DATA_LENGTH = 8_192;

export type RunClaim = {
  run: ManagedRun;
  disposition: "created" | "joined";
};

export async function claimRun(userId: string, input: ClaimRunRequest): Promise<RunClaim> {
  const database = getDatabase();
  const [scope] = await database
    .select({
      checkout: projectCheckouts,
      deviceName: devices.name,
    })
    .from(projectCheckouts)
    .innerJoin(devices, eq(projectCheckouts.deviceId, devices.id))
    .innerJoin(projects, eq(projectCheckouts.projectId, projects.id))
    .where(and(
      eq(projectCheckouts.id, input.checkoutId),
      eq(projectCheckouts.projectId, input.projectId),
      eq(projectCheckouts.userId, userId),
      eq(projects.userId, userId),
    ))
    .limit(1);
  if (!scope) throw new Error("Managed checkout was not found");

  const now = new Date();
  await database
    .update(runs)
    .set({ status: "orphaned", completedAt: now, updatedAt: now, error: "Executor heartbeat expired" })
    .where(and(
      eq(runs.userId, userId),
      eq(runs.projectId, input.projectId),
      eq(runs.checkoutId, input.checkoutId),
      eq(runs.fingerprint, input.fingerprint),
      eq(runs.status, "running"),
      lt(runs.updatedAt, new Date(now.getTime() - STALE_RUN_MS)),
    ));

  const [created] = await database
    .insert(runs)
    .values({
      id: randomUUID(),
      userId,
      projectId: input.projectId,
      checkoutId: input.checkoutId,
      deviceId: scope.checkout.deviceId,
      operation: input.operation,
      workflow: input.workflow,
      fingerprint: input.fingerprint,
      status: "running",
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return { run: toManagedRun(created, scope.deviceName), disposition: "created" };
  }

  const [existing] = await database
    .select({ run: runs, deviceName: devices.name })
    .from(runs)
    .innerJoin(devices, eq(runs.deviceId, devices.id))
    .where(and(
      eq(runs.userId, userId),
      eq(runs.projectId, input.projectId),
      eq(runs.checkoutId, input.checkoutId),
      eq(runs.fingerprint, input.fingerprint),
      eq(runs.status, "running"),
    ))
    .limit(1);
  if (!existing) throw new Error("Could not claim or locate the active run");
  return { run: toManagedRun(existing.run, existing.deviceName), disposition: "joined" };
}

export async function listRuns(userId: string, projectId?: string, limit = 30): Promise<ManagedRun[]> {
  await orphanStaleRuns(userId, projectId);
  const where = projectId
    ? and(eq(runs.userId, userId), eq(runs.projectId, projectId))
    : eq(runs.userId, userId);
  const rows = await getDatabase()
    .select({ run: runs, deviceName: devices.name })
    .from(runs)
    .innerJoin(devices, eq(runs.deviceId, devices.id))
    .where(where)
    .orderBy(desc(runs.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(({ run, deviceName }) => toManagedRun(run, deviceName));
}

export async function getRun(userId: string, runId: string): Promise<ManagedRun> {
  const [row] = await getDatabase()
    .select({ run: runs, deviceName: devices.name })
    .from(runs)
    .innerJoin(devices, eq(runs.deviceId, devices.id))
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Managed run was not found");
  if (row.run.status === "running" && row.run.updatedAt < new Date(Date.now() - STALE_RUN_MS)) {
    const completedAt = new Date();
    await getDatabase()
      .update(runs)
      .set({ status: "orphaned", completedAt, updatedAt: completedAt, error: "Executor heartbeat expired" })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId), eq(runs.status, "running")));
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
  const rows = await getDatabase()
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.id, after)))
    .orderBy(asc(runEvents.id))
    .limit(500);
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
  const database = getDatabase();
  const [row] = await database
    .insert(runEvents)
    .values({ runId, type, data, createdAt: now })
    .returning();
  if (!row) throw new Error("Postgres did not return the appended run event");

  const lifecycle = runUpdateForEvent(data, now);
  await database
    .update(runs)
    .set({ updatedAt: now, ...lifecycle })
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
  return toManagedRunEvent(row);
}

export async function heartbeatRun(userId: string, runId: string): Promise<void> {
  await getDatabase()
    .update(runs)
    .set({ updatedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.userId, userId), eq(runs.status, "running")));
}

async function orphanStaleRuns(userId: string, projectId?: string): Promise<void> {
  const now = new Date();
  await getDatabase()
    .update(runs)
    .set({ status: "orphaned", completedAt: now, updatedAt: now, error: "Executor heartbeat expired" })
    .where(and(
      eq(runs.userId, userId),
      ...(projectId ? [eq(runs.projectId, projectId)] : []),
      eq(runs.status, "running"),
      lt(runs.updatedAt, new Date(now.getTime() - STALE_RUN_MS)),
    ));
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

function toManagedRun(row: typeof runs.$inferSelect, deviceName: string): ManagedRun {
  return {
    id: row.id,
    projectId: row.projectId,
    checkoutId: row.checkoutId,
    deviceId: row.deviceId,
    deviceName,
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

function toManagedRunEvent(row: typeof runEvents.$inferSelect): ManagedRunEvent {
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
