import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type FdevProject = {
  projectDir: string;
  configPath: string;
};

export function resolveFdevProject(startDir: string, fileExists: (path: string) => boolean = existsSync): FdevProject {
  const configPath = findConfigUp(startDir, fileExists);
  if (!configPath) {
    throw new Error(`No fdev.config.ts found from ${startDir}`);
  }
  return {
    projectDir: dirname(configPath),
    configPath,
  };
}

export function findConfigUp(startDir: string, fileExists: (path: string) => boolean = existsSync): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, "fdev.config.ts");
    if (fileExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
