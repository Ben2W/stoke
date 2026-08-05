import { and, eq } from "drizzle-orm";
import { getDatabase } from "../db/client.ts";
import { devices } from "../db/schema.ts";

export type DeviceRow = typeof devices.$inferSelect;

export const deviceRepository = {
  async findById(deviceId: string): Promise<DeviceRow | undefined> {
    const [row] = await getDatabase().select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    return row;
  },

  async findOwnedById(userId: string, deviceId: string): Promise<DeviceRow | undefined> {
    const [row] = await getDatabase()
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
      .limit(1);
    return row;
  },

  async create(input: { id: string; userId: string; name: string; now: Date }): Promise<DeviceRow> {
    const [row] = await getDatabase()
      .insert(devices)
      .values({ ...input, createdAt: input.now, lastSeenAt: input.now })
      .returning();
    if (!row) throw new Error("Postgres did not return the registered device");
    return row;
  },

  async touch(input: { id: string; userId: string; name: string; now: Date }): Promise<DeviceRow> {
    const [row] = await getDatabase()
      .update(devices)
      .set({ name: input.name, lastSeenAt: input.now })
      .where(and(eq(devices.id, input.id), eq(devices.userId, input.userId)))
      .returning();
    if (!row) throw new Error("Postgres did not return the registered device");
    return row;
  },
};
