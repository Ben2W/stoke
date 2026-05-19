import { basename, dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

export const RIGKIT_DIR = "rigkit";
export const DEFAULT_CONFIG_FILE = "index.ts";
export const DEFAULT_CONFIG_PATH = join(RIGKIT_DIR, DEFAULT_CONFIG_FILE);
export const PROJECT_PACKAGE_NAME = "@rigkit/sdk";
export const FREESTYLE_PROVIDER_PACKAGE_NAME = "@rigkit/provider-freestyle";
export const FREESTYLE_SDK_PACKAGE_NAME = "freestyle";
export const FREESTYLE_SDK_PACKAGE_VERSION = "^0.1.51";

export type ConfigPathOptions = {
  chdir?: string;
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
  const workingDir = options.chdir ? resolve(cwd, options.chdir) : cwd;
  if (options.config) {
    const configPath = resolve(workingDir, options.config);
    return {
      projectDir: projectDirForConfigPath(configPath),
      configPath,
    };
  }

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
  if (options.config) return [resolveConfigPaths(options)];

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

export function rigConfigFilesInDir(dir: string): string[] {
  return existsSync(join(dir, DEFAULT_CONFIG_PATH)) ? [DEFAULT_CONFIG_PATH] : [];
}

export function isRigConfigFileName(name: string): boolean {
  return name === DEFAULT_CONFIG_PATH;
}

export function projectDirForConfigPath(configPath: string): string {
  const configDir = dirname(configPath);
  return basename(configDir) === RIGKIT_DIR ? dirname(configDir) : configDir;
}

function formatConfigNotFoundAt(configPath: string): string {
  return `No Rigkit config found at ${configPath}. Run "rig init" or pass --config=<file>.`;
}

function formatConfigNotFoundFrom(start: string): string {
  return `No Rigkit config found from ${start} upward. Run "rig init" or pass --config=<file>.`;
}
