import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { coreSchema, type CoreSchema } from "./schema/index.ts";

export const FDEV_STATE_SCHEMA_VERSION = "drizzle-push";

export type FdevDatabase<TSchema extends Record<string, unknown> = CoreSchema> =
  BunSQLiteDatabase<TSchema> & { $client: Database };

export type FdevDatabaseSchema = Record<string, unknown>;

export type CreateFdevDatabaseOptions<TSchema extends FdevDatabaseSchema = CoreSchema> = {
  schema?: TSchema;
};

export type SchemaSyncResult = {
  applied: string[];
  schemaVersion: string;
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
  try {
    const result = await pushFdevDatabaseSchema(db, schema);
    return toSchemaSyncResult(result);
  } catch (error) {
    const resetStatements = resetFdevDatabase(db);
    const result = await pushFdevDatabaseSchema(db, schema);
    return toSchemaSyncResult(result, {
      resetStatements,
      resetReason: errorMessage(error),
    });
  }
}

async function pushFdevDatabaseSchema<TSchema extends FdevDatabaseSchema>(
  db: FdevDatabase<TSchema>,
  schema: TSchema,
): Promise<PushSQLiteSchemaResult> {
  const drizzleKitApi = ["drizzle-kit", "api"].join("/");
  const { pushSQLiteSchema } = await import(drizzleKitApi);
  const pushSchema = pushSQLiteSchema as unknown as PushSQLiteSchemaForBun;
  const result = await silenceStdout(() => pushSchema(schema, db));
  await silenceStdout(() => result.apply());
  return result;
}

function toSchemaSyncResult(
  result: PushSQLiteSchemaResult,
  reset?: { resetStatements: string[]; resetReason: string },
): SchemaSyncResult {
  const statements = [...(reset?.resetStatements ?? []), ...result.statementsToExecute];
  const warnings = [...result.warnings];
  if (reset) {
    warnings.unshift(`Reset fdev state database after Drizzle push failed: ${reset.resetReason}`);
  }
  return {
    applied: statements.length > 0 ? [FDEV_STATE_SCHEMA_VERSION] : [],
    schemaVersion: FDEV_STATE_SCHEMA_VERSION,
    statements,
    warnings,
    hasDataLoss: reset !== undefined || result.hasDataLoss,
  };
}

function resetFdevDatabase<TSchema extends FdevDatabaseSchema>(db: FdevDatabase<TSchema>): string[] {
  const rows = db.$client
    .query(`
      SELECT type, name
      FROM sqlite_schema
      WHERE type IN ('table', 'view', 'trigger')
        AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type
        WHEN 'view' THEN 0
        WHEN 'trigger' THEN 1
        ELSE 2
      END
    `)
    .all() as Array<{ type: "table" | "view" | "trigger"; name: string }>;

  const statements = [
    "PRAGMA foreign_keys=OFF",
    ...rows.map((row) => `DROP ${row.type.toUpperCase()} IF EXISTS ${quoteSqlIdentifier(row.name)}`),
    "PRAGMA foreign_keys=ON",
  ];
  const dropStatements = statements.slice(1, -1);
  const reset = db.$client.transaction(() => {
    for (const sql of dropStatements) {
      db.$client.run(sql);
    }
  });
  db.$client.run("PRAGMA foreign_keys=OFF");
  try {
    reset();
  } finally {
    db.$client.run("PRAGMA foreign_keys=ON");
  }
  return statements;
}

function quoteSqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
