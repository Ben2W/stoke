import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type RigkitProject = {
  projectDir: string;
  configPath: string;
};

export function resolveRigkitProject(startDir: string, fileExists: (path: string) => boolean = existsSync): RigkitProject {
  const configPath = findConfigUp(startDir, fileExists);
  if (!configPath) {
    throw new Error(`No rig.config.ts found from ${startDir}`);
  }
  return {
    projectDir: dirname(configPath),
    configPath,
  };
}

export function findConfigUp(startDir: string, fileExists: (path: string) => boolean = existsSync): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, "rig.config.ts");
    if (fileExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
