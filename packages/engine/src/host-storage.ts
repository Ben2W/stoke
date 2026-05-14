import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hash } from "./hash.ts";
import type { ProviderStorage, ProviderStorageRecord } from "./provider/types.ts";
import type { JsonValue } from "./types.ts";

export type ProviderHostStorageOptions = {
  providerId: string;
  rootDir?: string;
};

export type ProviderHostStorageFactory = (options: ProviderHostStorageOptions) => ProviderStorage;

type ProviderHostStorageFile = {
  providerId: string;
  records: Record<string, Omit<ProviderStorageRecord, "providerId" | "key">>;
};

export function defaultProviderHostStorageDir(): string {
  return process.env.RIGKIT_HOST_STORAGE_DIR ?? join(homedir(), ".rigkit", "providers");
}

export function createFileProviderHostStorage(options: ProviderHostStorageOptions): ProviderStorage {
  return new FileProviderHostStorage(options.providerId, providerHostStoragePath(options));
}

function providerHostStoragePath(options: ProviderHostStorageOptions): string {
  const rootDir = options.rootDir ?? defaultProviderHostStorageDir();
  const slug = options.providerId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
  return join(rootDir, `${slug}-${hash(options.providerId).slice(0, 12)}.json`);
}

class FileProviderHostStorage implements ProviderStorage {
  constructor(
    private readonly providerId: string,
    private readonly path: string,
  ) {}

  get<Value extends JsonValue = JsonValue>(key: string): ProviderStorageRecord<Value> | undefined {
    const file = this.read();
    const record = file.records[key];
    return record
      ? {
        providerId: this.providerId,
        key,
        value: record.value as Value,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
      : undefined;
  }

  set<Value extends JsonValue = JsonValue>(key: string, value: Value): ProviderStorageRecord<Value> {
    const file = this.read();
    const now = new Date().toISOString();
    const existing = file.records[key];
    const record: ProviderStorageRecord<Value> = {
      providerId: this.providerId,
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    file.records[key] = {
      value,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    this.write(file);
    return record;
  }

  delete(key: string): void {
    const file = this.read();
    delete file.records[key];
    this.write(file);
  }

  entries(prefix = ""): ProviderStorageRecord[] {
    const file = this.read();
    return Object.entries(file.records)
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, record]) => ({
        providerId: this.providerId,
        key,
        value: record.value,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
  }

  private read(): ProviderHostStorageFile {
    if (!existsSync(this.path)) {
      return { providerId: this.providerId, records: {} };
    }

    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
    if (!isHostStorageFile(parsed, this.providerId)) {
      throw new Error(`Invalid Rigkit provider host storage at ${this.path}`);
    }
    return parsed;
  }

  private write(file: ProviderHostStorageFile): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

function isHostStorageFile(value: unknown, providerId: string): value is ProviderHostStorageFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { providerId?: unknown; records?: unknown };
  if (record.providerId !== providerId) return false;
  if (!record.records || typeof record.records !== "object" || Array.isArray(record.records)) return false;
  return Object.values(record.records).every((entry) =>
    Boolean(
      entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { createdAt?: unknown }).createdAt === "string" &&
        typeof (entry as { updatedAt?: unknown }).updatedAt === "string" &&
        "value" in entry
    )
  );
}
