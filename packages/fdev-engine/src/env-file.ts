import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function loadDotEnv(projectDir: string): void {
  for (const path of findDotEnvFiles(projectDir)) {
    loadDotEnvFile(path);
  }
}

function loadDotEnvFile(path: string): void {
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(rawValue);
  }
}

function findDotEnvFiles(projectDir: string): string[] {
  const files: string[] = [];
  let current = projectDir;

  while (true) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) files.unshift(candidate);

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return files;
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
