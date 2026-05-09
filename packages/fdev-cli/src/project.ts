import { dirname, join, resolve } from "node:path";

export const DEFAULT_CONFIG_FILE = "fdev.config.ts";
export const SDK_PACKAGE_NAME = "@freestyle-sh/fdev-sdk";
export const RUNTIME_PACKAGE_NAME = "@freestyle-sh/fdev-runtime";
export const FREESTYLE_PROVIDER_PACKAGE_NAME = "@freestyle-sh/fdev-provider-freestyle";

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
