import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

export const DEFAULT_CONFIG_FILE = "rig.config.ts";
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
      projectDir: dirname(configPath),
      configPath,
    };
  }

  const projectDir = options.chdir ? workingDir : findNearestProjectDir(workingDir);
  const configPath = join(projectDir, DEFAULT_CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(formatConfigNotFoundAt(configPath, {
      commandCwd: cwd,
      hint: namedRigConfigFilesHint(projectDir),
    }));
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
  let hint: ConfigFilesHint | undefined;
  for (;;) {
    if (existsSync(join(current, DEFAULT_CONFIG_FILE))) return current;
    hint ??= namedRigConfigFilesHint(current);
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(formatConfigNotFoundFrom(start, { commandCwd: start, hint }));
    }
    current = parent;
  }
}

function visitProjectDirs(dir: string, projects: DiscoveredProject[]): void {
  const configFiles = rigConfigFilesInDir(dir);
  if (configFiles.length > 0) {
    for (const configFile of configFiles) {
      projects.push({ projectDir: dir, configPath: join(dir, configFile) });
    }
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
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && isRigConfigFileName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === DEFAULT_CONFIG_FILE) return -1;
      if (right === DEFAULT_CONFIG_FILE) return 1;
      return left.localeCompare(right);
    });
}

export function isRigConfigFileName(name: string): boolean {
  return name === DEFAULT_CONFIG_FILE || name.endsWith(".rig.config.ts");
}

type ConfigFilesHint = {
  dir: string;
  files: string[];
};

function namedRigConfigFilesHint(dir: string): ConfigFilesHint | undefined {
  const files = rigConfigFilesInDir(dir).filter((file) => file !== DEFAULT_CONFIG_FILE);
  return files.length > 0 ? { dir, files } : undefined;
}

function formatConfigNotFoundAt(
  configPath: string,
  options: { commandCwd: string; hint?: ConfigFilesHint },
): string {
  return appendConfigFilesHint(
    `No Rigkit config found at ${configPath}.`,
    options,
  );
}

function formatConfigNotFoundFrom(
  start: string,
  options: { commandCwd: string; hint?: ConfigFilesHint },
): string {
  return appendConfigFilesHint(
    `No Rigkit config found from ${start} upward.`,
    options,
  );
}

function appendConfigFilesHint(
  message: string,
  options: { commandCwd: string; hint?: ConfigFilesHint },
): string {
  const hint = options.hint;
  if (!hint) return `${message} Run "rig init" or pass -config=<file>.`;

  const configFile = hint.files[0]!;
  const configPath = displayPath(options.commandCwd, join(hint.dir, configFile));
  const projectDir = displayPath(options.commandCwd, hint.dir);

  return [
    message,
    `Found named Rigkit configs in ${hint.dir}:`,
    ...hint.files.map((file) => `- ${file}`),
    "",
    "Choose one explicitly:",
    `  rig -config=${configPath} <command>`,
    `  rig -chdir=${projectDir} -config=${configFile} <command>`,
  ].join("\n");
}

function displayPath(from: string, path: string): string {
  const relativePath = relative(from, path);
  if (!relativePath) return ".";
  if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) return relativePath;
  return path;
}
