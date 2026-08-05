import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDatabase } from "../db/client.ts";
import { devices, projectCheckouts, projects, runEvents, runs } from "../db/schema.ts";

export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type RunWithDevice = { run: RunRow; deviceName: string };
type RunIdentity = {
  userId: string;
  projectId: string;
  checkoutId: string;
  fingerprint: string;
};
type StaleRunClaim = RunIdentity & { before: Date; now: Date };

export const runRepository = {
  async findClaimScope(userId: string, projectId: string, checkoutId: string) {
    const [scope] = await getDatabase()
      .select({ checkout: projectCheckouts, deviceName: devices.name })
      .from(projectCheckouts)
      .innerJoin(devices, eq(projectCheckouts.deviceId, devices.id))
      .innerJoin(projects, eq(projectCheckouts.projectId, projects.id))
      .where(and(
        eq(projectCheckouts.id, checkoutId),
        eq(projectCheckouts.projectId, projectId),
        eq(projectCheckouts.userId, userId),
        eq(projects.userId, userId),
      ))
      .limit(1);
    return scope;
  },

  async orphanClaim(input: StaleRunClaim): Promise<void> {
    await getDatabase()
      .update(runs)
      .set({
        status: "orphaned",
        completedAt: input.now,
        updatedAt: input.now,
        error: "Executor heartbeat expired",
      })
      .where(and(
        eq(runs.userId, input.userId),
        eq(runs.projectId, input.projectId),
        eq(runs.checkoutId, input.checkoutId),
        eq(runs.fingerprint, input.fingerprint),
        eq(runs.status, "running"),
        lt(runs.updatedAt, input.before),
      ));
  },

  async create(input: typeof runs.$inferInsert): Promise<RunRow | undefined> {
    const [row] = await getDatabase().insert(runs).values(input).onConflictDoNothing().returning();
    return row;
  },

  async findActive(input: RunIdentity): Promise<RunWithDevice | undefined> {
    const [row] = await getDatabase()
      .select({ run: runs, deviceName: devices.name })
      .from(runs)
      .innerJoin(devices, eq(runs.deviceId, devices.id))
      .where(and(
        eq(runs.userId, input.userId),
        eq(runs.projectId, input.projectId),
        eq(runs.checkoutId, input.checkoutId),
        eq(runs.fingerprint, input.fingerprint),
        eq(runs.status, "running"),
      ))
      .limit(1);
    return row;
  },

  async listForUser(userId: string, projectId?: string, limit = 30): Promise<RunWithDevice[]> {
    const where = projectId
      ? and(eq(runs.userId, userId), eq(runs.projectId, projectId))
      : eq(runs.userId, userId);
    return await getDatabase()
      .select({ run: runs, deviceName: devices.name })
      .from(runs)
      .innerJoin(devices, eq(runs.deviceId, devices.id))
      .where(where)
      .orderBy(desc(runs.startedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  },

  async findOwnedById(userId: string, runId: string): Promise<RunWithDevice | undefined> {
    const [row] = await getDatabase()
      .select({ run: runs, deviceName: devices.name })
      .from(runs)
      .innerJoin(devices, eq(runs.deviceId, devices.id))
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .limit(1);
    return row;
  },

  async orphanStale(userId: string, before: Date, now: Date, projectId?: string): Promise<void> {
    await getDatabase()
      .update(runs)
      .set({
        status: "orphaned",
        completedAt: now,
        updatedAt: now,
        error: "Executor heartbeat expired",
      })
      .where(and(
        eq(runs.userId, userId),
        ...(projectId ? [eq(runs.projectId, projectId)] : []),
        eq(runs.status, "running"),
        lt(runs.updatedAt, before),
      ));
  },

  async orphanById(userId: string, runId: string, now: Date): Promise<void> {
    await getDatabase()
      .update(runs)
      .set({
        status: "orphaned",
        completedAt: now,
        updatedAt: now,
        error: "Executor heartbeat expired",
      })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId), eq(runs.status, "running")));
  },

  async listEvents(runId: string, after: number): Promise<RunEventRow[]> {
    return await getDatabase()
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.id, after)))
      .orderBy(asc(runEvents.id))
      .limit(500);
  },

  async appendEvent(input: typeof runEvents.$inferInsert): Promise<RunEventRow> {
    const [row] = await getDatabase().insert(runEvents).values(input).returning();
    if (!row) throw new Error("Postgres did not return the appended run event");
    return row;
  },

  async update(userId: string, runId: string, values: Partial<typeof runs.$inferInsert>): Promise<void> {
    await getDatabase()
      .update(runs)
      .set(values)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
  },

  async heartbeat(userId: string, runId: string, now: Date): Promise<void> {
    await getDatabase()
      .update(runs)
      .set({ updatedAt: now })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId), eq(runs.status, "running")));
  },
};
