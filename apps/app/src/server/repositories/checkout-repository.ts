import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "../db/client.ts";
import { devices, projectCheckouts } from "../db/schema.ts";

export type CheckoutRow = typeof projectCheckouts.$inferSelect;
export type CheckoutWithDevice = { checkout: CheckoutRow; deviceName: string };

export const checkoutRepository = {
  async listForUser(userId: string, deviceId?: string): Promise<CheckoutWithDevice[]> {
    const where = deviceId
      ? and(eq(projectCheckouts.userId, userId), eq(projectCheckouts.deviceId, deviceId))
      : eq(projectCheckouts.userId, userId);
    return await getDatabase()
      .select({ checkout: projectCheckouts, deviceName: devices.name })
      .from(projectCheckouts)
      .innerJoin(devices, eq(projectCheckouts.deviceId, devices.id))
      .where(where)
      .orderBy(desc(projectCheckouts.lastSeenAt));
  },

  async findByDevicePath(deviceId: string, path: string): Promise<CheckoutRow | undefined> {
    const [row] = await getDatabase()
      .select()
      .from(projectCheckouts)
      .where(and(eq(projectCheckouts.deviceId, deviceId), eq(projectCheckouts.path, path)))
      .limit(1);
    return row;
  },

  async create(input: {
    id: string;
    userId: string;
    projectId: string;
    deviceId: string;
    path: string;
    gitRemote?: string;
    now: Date;
  }): Promise<CheckoutRow> {
    const [row] = await getDatabase()
      .insert(projectCheckouts)
      .values({ ...input, createdAt: input.now, lastSeenAt: input.now })
      .returning();
    if (!row) throw new Error("Postgres did not return the registered checkout");
    return row;
  },

  async relink(input: {
    id: string;
    projectId: string;
    gitRemote: string | null;
    now: Date;
  }): Promise<CheckoutRow> {
    const [row] = await getDatabase()
      .update(projectCheckouts)
      .set({ projectId: input.projectId, gitRemote: input.gitRemote, lastSeenAt: input.now })
      .where(eq(projectCheckouts.id, input.id))
      .returning();
    if (!row) throw new Error("Postgres did not return the registered checkout");
    return row;
  },
};
