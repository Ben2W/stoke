import type { ManagedRun, ManagedRunEvent } from "@stoke/managed";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/server/db/schema.js";

const STALE_RUN_MS = 2 * 60_000;
const MAX_EVENT_DATA_LENGTH = 8_192;
let database: PostgresJsDatabase<typeof schema> | undefined;

function getDatabase(): PostgresJsDatabase<typeof schema> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!database) {
    const client = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function getRun(userId: string, runId: string): Promise<ManagedRun> {
  const [row] = await getDatabase()
    .select({ run: schema.runs, deviceName: schema.devices.name })
    .from(schema.runs)
    .innerJoin(schema.devices, eq(schema.runs.deviceId, schema.devices.id))
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Managed run was not found");
  if (row.run.status === "running" && row.run.updatedAt < new Date(Date.now() - STALE_RUN_MS)) {
    const completedAt = new Date();
    await getDatabase()
      .update(schema.runs)
      .set({ status: "orphaned", completedAt, updatedAt: completedAt, error: "Executor heartbeat expired" })
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId), eq(schema.runs.status, "running")));
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

export async function listRunEvents(userId: string, runId: string, after = 0): Promise<ManagedRunEvent[]> {
  await getRun(userId, runId);
  const rows = await getDatabase()
    .select()
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.id, after)))
    .orderBy(asc(schema.runEvents.id))
    .limit(500);
  return rows.map(toManagedRunEvent);
}

export async function appendRunEvent(userId: string, runId: string, value: unknown): Promise<ManagedRunEvent> {
  const run = await getRun(userId, runId);
  if (run.status !== "running") throw new Error("Managed run is no longer active");
  const data = sanitizeRunEvent(value);
  const type = data.type as string;
  const now = new Date();
  const database = getDatabase();
  const [row] = await database
    .insert(schema.runEvents)
    .values({ runId, type, data, createdAt: now })
    .returning();
  if (!row) throw new Error("Postgres did not return the appended run event");

  await database
    .update(schema.runs)
    .set({ updatedAt: now, ...runUpdateForEvent(data, now) })
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId)));
  return toManagedRunEvent(row);
}

export async function heartbeatRun(userId: string, runId: string): Promise<void> {
  await getDatabase()
    .update(schema.runs)
    .set({ updatedAt: new Date() })
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId), eq(schema.runs.status, "running")));
}

function runUpdateForEvent(
  data: Record<string, unknown>,
  now: Date,
): Partial<typeof schema.runs.$inferInsert> {
  if (data.type === "workflow.apply.started" && typeof data.workflow === "string") {
    return { workflow: data.workflow };
  }
  if (data.type === "plan.created" || data.type === "workflow.apply.completed") {
    return {
      ...(typeof data.nodeCount === "number" ? { nodeCount: Math.max(0, Math.round(data.nodeCount)) } : {}),
      ...(typeof data.cachedNodeCount === "number"
        ? { cachedNodeCount: Math.max(0, Math.round(data.cachedNodeCount)) }
        : {}),
      ...(typeof data.workflow === "string" ? { workflow: data.workflow } : {}),
    };
  }
  if (data.type === "run.completed") return { status: "completed", completedAt: now };
  if (data.type === "run.failed") {
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
  if (value.type === "run.completed") return { type: "run.completed" };
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (/token|secret|password|authorization|cookie/i.test(key)) return "[redacted]";
  if (typeof value === "string") return redactSecrets(value).slice(0, MAX_EVENT_DATA_LENGTH);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey),
    ]));
  }
  return String(value ?? "");
}

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]")
    .replace(/((?:token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]");
}

function toManagedRun(row: typeof schema.runs.$inferSelect, deviceName: string): ManagedRun {
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

function toManagedRunEvent(row: typeof schema.runEvents.$inferSelect): ManagedRunEvent {
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
