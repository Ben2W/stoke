import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FDEV_ENGINE_VERSION } from "@freestyle-sh/fdev-engine";
import { FDEV_CLI_VERSION } from "./version.ts";

export const DEFAULT_CONFIG_FILE = "fdev.config.ts";
export const SDK_PACKAGE_NAME = "@freestyle-sh/fdev-sdk";

export type ConfigPathOptions = {
  project?: string;
  config?: string;
  cwd?: string;
};

export type ResolvedConfigPaths = {
  projectDir: string;
  configPath: string;
};

export function resolveConfigPaths(options: ConfigPathOptions): ResolvedConfigPaths {
  const cwd = resolve(options.cwd ?? process.cwd());
  const projectBase = resolve(cwd, options.project ?? ".");
  const configPath = options.config
    ? resolve(options.project ? projectBase : cwd, options.config)
    : join(projectBase, DEFAULT_CONFIG_FILE);

  return {
    projectDir: dirname(configPath),
    configPath,
  };
}

export function assertVersionAlignment(projectDir: string): void {
  const projectSdk = readLocalSdkVersion(projectDir);
  if (!projectSdk) {
    throw new Error(
      [
        `No local ${SDK_PACKAGE_NAME} install found for ${projectDir}.`,
        ``,
        `Run "fdev init", then install dependencies for the project.`,
      ].join("\n"),
    );
  }

  if (FDEV_CLI_VERSION === FDEV_ENGINE_VERSION && FDEV_CLI_VERSION === projectSdk.version) {
    return;
  }

  throw new Error(
    [
      `fdev version mismatch`,
      ``,
      `global CLI:  ${FDEV_CLI_VERSION}`,
      `engine:      ${FDEV_ENGINE_VERSION}`,
      `project SDK: ${projectSdk.version}`,
      ``,
      `Install matching versions:`,
      `  npm i -g @freestyle-sh/fdev-cli@${projectSdk.version}`,
      `or`,
      `  pnpm add -D ${SDK_PACKAGE_NAME}@${FDEV_CLI_VERSION}`,
    ].join("\n"),
  );
}

export function readLocalSdkVersion(projectDir: string): { version: string; packageJsonPath: string } | undefined {
  const packageJsonPath = join(projectDir, "node_modules", "@freestyle-sh", "fdev-sdk", "package.json");
  if (!existsSync(packageJsonPath)) return undefined;

  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new Error(`${packageJsonPath} does not declare a package version`);
  }

  return {
    version: parsed.version,
    packageJsonPath,
  };
}
