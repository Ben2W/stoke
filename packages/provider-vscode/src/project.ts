import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RIGKIT_ENTRYPOINT = join("rigkit", "index.ts");

export type RigkitProject = {
  projectDir: string;
  configPath: string;
};

export function resolveRigkitProject(startDir: string, fileExists: (path: string) => boolean = existsSync): RigkitProject {
  const configPath = findConfigUp(startDir, fileExists);
  if (!configPath) {
    throw new Error(`No ${RIGKIT_ENTRYPOINT} found from ${startDir}`);
  }
  return {
    projectDir: dirname(dirname(configPath)),
    configPath,
  };
}

export function findConfigUp(startDir: string, fileExists: (path: string) => boolean = existsSync): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, RIGKIT_ENTRYPOINT);
    if (fileExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
