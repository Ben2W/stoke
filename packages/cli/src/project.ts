import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

export const DEFAULT_CONFIG_FILE = "rig.config.ts";
export const PROJECT_PACKAGE_NAME = "@rigkit/sdk";
export const FREESTYLE_PROVIDER_PACKAGE_NAME = "@rigkit/provider-freestyle";
export const FREESTYLE_SDK_PACKAGE_NAME = "freestyle";
export const FREESTYLE_SDK_PACKAGE_VERSION = "^0.1.51";

export type ConfigPathOptions = {
  project?: string;
  config?: string;
  cwd?: string;
};

export type ResolvedConfigPaths = {
  projectDir: string;
  configPath: string;
};

export type DiscoveredProject = ResolvedConfigPaths;

export function resolveConfigPaths(options: ConfigPathOptions): ResolvedConfigPaths {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (options.config) {
    const projectBase = options.project ? resolve(cwd, options.project) : cwd;
    const configPath = resolve(projectBase, options.config);
    return {
      projectDir: dirname(configPath),
      configPath,
    };
  }

  const projectDir = options.project ? resolve(cwd, options.project) : findNearestProjectDir(cwd);
  const configPath = join(projectDir, DEFAULT_CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(`No Rigkit config found at ${configPath}. Run "rig init" or pass --config <file>.`);
  }

  return {
    projectDir,
    configPath,
  };
}

export function discoverProjectConfigs(options: ConfigPathOptions = {}): DiscoveredProject[] {
  if (options.config) return [resolveConfigPaths(options)];

  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(cwd, options.project ?? ".");
  const projects: DiscoveredProject[] = [];
  visitProjectDirs(root, projects);
  return projects.sort((left, right) => left.configPath.localeCompare(right.configPath));
}

function findNearestProjectDir(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, DEFAULT_CONFIG_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No Rigkit config found from ${start} upward. Run "rig init" or pass --config <file>.`);
    }
    current = parent;
  }
}

function visitProjectDirs(dir: string, projects: DiscoveredProject[]): void {
  const configPath = join(dir, DEFAULT_CONFIG_FILE);
  if (existsSync(configPath)) {
    projects.push({ projectDir: dir, configPath });
    return;
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (shouldSkipDiscoveryDir(entry.name)) continue;
    visitProjectDirs(join(dir, entry.name), projects);
  }
}

function shouldSkipDiscoveryDir(name: string): boolean {
  return name === ".git" ||
    name === ".rigkit" ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build";
}
