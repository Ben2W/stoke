import { randomUUID } from "node:crypto";
import type {
  ManagedCheckout,
  ManagedDevice,
  RegisterCheckoutRequest,
  RegisterDeviceRequest,
} from "@stoke/managed";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "./db/client.ts";
import { devices, projectCheckouts, projects } from "./db/schema.ts";

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
  const database = getDatabase();
  const [existing] = await database.select().from(devices).where(eq(devices.id, input.id)).limit(1);
  if (existing && existing.userId !== userId) {
    throw new ManagedResourceConflictError("Device ID is already registered", { deviceId: input.id });
  }

  const now = new Date();
  const [row] = existing
    ? await database
        .update(devices)
        .set({ name: input.name, lastSeenAt: now })
        .where(and(eq(devices.id, input.id), eq(devices.userId, userId)))
        .returning()
    : await database
        .insert(devices)
        .values({ id: input.id, userId, name: input.name, createdAt: now, lastSeenAt: now })
        .returning();

  if (!row) throw new Error("Postgres did not return the registered device");
  return toManagedDevice(row);
}

export async function listCheckouts(
  userId: string,
  deviceId?: string,
): Promise<ManagedCheckout[]> {
  const where = deviceId
    ? and(eq(projectCheckouts.userId, userId), eq(projectCheckouts.deviceId, deviceId))
    : eq(projectCheckouts.userId, userId);
  const rows = await getDatabase()
    .select({ checkout: projectCheckouts, deviceName: devices.name })
    .from(projectCheckouts)
    .innerJoin(devices, eq(projectCheckouts.deviceId, devices.id))
    .where(where)
    .orderBy(desc(projectCheckouts.lastSeenAt));
  return rows.map(({ checkout, deviceName }) => toManagedCheckout(checkout, deviceName));
}

export async function registerCheckout(
  userId: string,
  input: RegisterCheckoutRequest,
): Promise<ManagedCheckout> {
  const database = getDatabase();
  const [[project], [device], [existing]] = await Promise.all([
    database
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, userId)))
      .limit(1),
    database
      .select()
      .from(devices)
      .where(and(eq(devices.id, input.deviceId), eq(devices.userId, userId)))
      .limit(1),
    database
      .select()
      .from(projectCheckouts)
      .where(and(eq(projectCheckouts.deviceId, input.deviceId), eq(projectCheckouts.path, input.path)))
      .limit(1),
  ]);

  if (!project) throw new Error("Managed project was not found");
  if (!device) throw new Error("Device must be registered before adding a checkout");
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
  const [row] = existing
    ? await database
        .update(projectCheckouts)
        .set({
          projectId: input.projectId,
          gitRemote: input.gitRemote ?? existing.gitRemote,
          lastSeenAt: now,
        })
        .where(eq(projectCheckouts.id, existing.id))
        .returning()
    : await database
        .insert(projectCheckouts)
        .values({
          id: randomUUID(),
          userId,
          projectId: input.projectId,
          deviceId: input.deviceId,
          path: input.path,
          gitRemote: input.gitRemote,
          createdAt: now,
          lastSeenAt: now,
        })
        .returning();

  if (!row) throw new Error("Postgres did not return the registered checkout");
  return toManagedCheckout(row, device.name);
}

function toManagedDevice(row: typeof devices.$inferSelect): ManagedDevice {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

function toManagedCheckout(
  row: typeof projectCheckouts.$inferSelect,
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
