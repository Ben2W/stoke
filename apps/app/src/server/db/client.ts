import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

let database: PostgresJsDatabase<typeof schema> | undefined;

export class ControlPlaneConfigError extends Error {
  override name = "ControlPlaneConfigError";
}

export function getDatabase(): PostgresJsDatabase<typeof schema> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ControlPlaneConfigError("DATABASE_URL is not configured");
  }

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
