import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

export const RIGKIT_DIR = "rigkit";
export const DEFAULT_CONFIG_FILE = "index.ts";
export const DEFAULT_CONFIG_PATH = join(RIGKIT_DIR, DEFAULT_CONFIG_FILE);

export type ConfigPathOptions = {
  chdir?: string;
  cwd?: string;
};

export type ResolvedConfigPaths = {
  projectDir: string;
  configPath: string;
};

export type DiscoveredProject = ResolvedConfigPaths;

export function resolveConfigPaths(options: ConfigPathOptions): ResolvedConfigPaths {
  const cwd = resolve(options.cwd ?? process.cwd());
  const workingDir = options.chdir ? resolve(cwd, options.chdir) : cwd;

  const projectDir = options.chdir ? workingDir : findNearestProjectDir(workingDir);
  const configPath = join(projectDir, DEFAULT_CONFIG_PATH);

  if (!existsSync(configPath)) {
    throw new Error(formatConfigNotFoundAt(configPath));
  }

  return {
    projectDir,
    configPath,
  };
}

export function discoverProjectConfigs(options: ConfigPathOptions = {}): DiscoveredProject[] {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(cwd, options.chdir ?? ".");
  const projects: DiscoveredProject[] = [];
  visitProjectDirs(root, projects);
  return projects.sort((left, right) => left.configPath.localeCompare(right.configPath));
}

function findNearestProjectDir(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, DEFAULT_CONFIG_PATH))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(formatConfigNotFoundFrom(start));
    }
    current = parent;
  }
}

function visitProjectDirs(dir: string, projects: DiscoveredProject[]): void {
  const configPath = join(dir, DEFAULT_CONFIG_PATH);
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

function formatConfigNotFoundAt(configPath: string): string {
  return `No Stoke config found at ${configPath}. Run "stoke init".`;
}

function formatConfigNotFoundFrom(start: string): string {
  return `No Stoke config found from ${start} upward. Run "stoke init".`;
}
