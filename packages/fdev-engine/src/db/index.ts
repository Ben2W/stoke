import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { coreSchema, type CoreSchema } from "./schema/index.ts";

export type FdevDatabase<TSchema extends Record<string, unknown> = CoreSchema> =
  BunSQLiteDatabase<TSchema> & { $client: Database };

export type FdevDatabaseSchema = Record<string, unknown>;

export type CreateFdevDatabaseOptions<TSchema extends FdevDatabaseSchema = CoreSchema> = {
  schema?: TSchema;
};

export type SchemaSyncResult = {
  statements: string[];
  warnings: string[];
  hasDataLoss: boolean;
};

type DrizzleKitBunSQLiteDatabase = Pick<FdevDatabase<FdevDatabaseSchema>, "all" | "run">;

type PushSQLiteSchemaResult = {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
  apply(): Promise<void>;
};

type PushSQLiteSchemaForBun = (
  imports: FdevDatabaseSchema,
  drizzleInstance: DrizzleKitBunSQLiteDatabase,
) => Promise<PushSQLiteSchemaResult>;

export function createFdevDatabase<TSchema extends FdevDatabaseSchema = CoreSchema>(
  path: string,
  options: CreateFdevDatabaseOptions<TSchema> = {},
): FdevDatabase<TSchema> {
  mkdirSync(dirname(path), { recursive: true });
  const db = drizzle(new Database(path, { create: true }), {
    schema: options.schema ?? (coreSchema as unknown as TSchema),
  });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

export async function syncFdevDatabaseSchema<TSchema extends FdevDatabaseSchema>(
  db: FdevDatabase<TSchema>,
  schema: TSchema,
): Promise<SchemaSyncResult> {
  const pushSchema = pushSQLiteSchema as unknown as PushSQLiteSchemaForBun;
  const result = await silenceStdout(() => pushSchema(schema, db));
  await result.apply();

  return {
    statements: result.statementsToExecute,
    warnings: result.warnings,
    hasDataLoss: result.hasDataLoss,
  };
}

export function composeFdevSchema<const Schemas extends readonly FdevDatabaseSchema[]>(
  schemas: Schemas,
): CoreSchema & Schemas[number] {
  return Object.assign({}, coreSchema, ...schemas) as CoreSchema & Schemas[number];
}

async function silenceStdout<T>(run: () => Promise<T>): Promise<T> {
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await run();
  } finally {
    process.stdout.write = write;
  }
}
