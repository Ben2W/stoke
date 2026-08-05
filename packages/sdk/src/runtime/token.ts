import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readOrCreateToken(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8").trim();

  mkdirSync(dirname(path), { recursive: true });
  const token = `stoke_${crypto.randomUUID().replaceAll("-", "")}`;
  writeFileSync(path, `${token}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms without chmod support.
  }
  return token;
}
