import type { WorkflowProviderController } from "@freestyle-sh/fdev-engine";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
import type { GcloudAccessCredentials, GcloudConfigCopy } from "./inject.ts";
import {
  DEFAULT_GCLOUD_CREDENTIAL_KEY,
  normalizeScopes,
  type GcloudStoredCredentials,
} from "./store.ts";
import type { createGcloudAuthStore } from "./store.ts";

export const GCLOUD_CONFIG_COPY_PROVIDER_ID = "gcloud-config-copy";

export const DEFAULT_GCLOUD_AUTH_SCOPES = [
  "email",
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
] as const;

export const DEFAULT_GCLOUD_INSTALL_URL = "https://cloud.google.com/sdk/docs/install";

const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 55 * 60;

export type GcloudConfigCopyConfig = {
  command?: string;
  key?: string;
  account?: string;
  scopes?: readonly string[];
  installUrl?: string;
  accessTokenLifetimeSeconds?: number;
  configDir?: string;
};

export type GcloudFreshAccessTokenOptions = {
  key?: string;
  account?: string;
  scopes?: readonly string[];
};

export type GcloudConfigFilesOptions = {
  account?: string;
  configDir?: string;
};

export type GcloudConfigCopyRuntime = {
  freshAccessToken(options?: GcloudFreshAccessTokenOptions): Promise<GcloudAccessCredentials>;
  configFiles(options?: GcloudConfigFilesOptions): Promise<GcloudConfigCopy>;
};

export type GcloudCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GcloudCommandRunner = (command: string, args: readonly string[]) => Promise<GcloudCommandResult>;

type GcloudAuthStore = ReturnType<typeof createGcloudAuthStore>;

export function createGcloudConfigCopyController(
  config: GcloudConfigCopyConfig,
  store: GcloudAuthStore,
  runner: GcloudCommandRunner = runGcloudCommand,
): WorkflowProviderController<GcloudConfigCopyRuntime> {
  return {
    providerId: GCLOUD_CONFIG_COPY_PROVIDER_ID,
    runtime() {
      return {
        freshAccessToken: async (options = {}) =>
          await freshAccessToken({
            config,
            store,
            runner,
            options,
          }),
        configFiles: async (options = {}) =>
          await localGcloudConfigFiles({
            config,
            runner,
            options,
          }),
      };
    },
  };
}

export async function assertLocalGcloudReady(
  config: GcloudConfigCopyConfig,
  runner: GcloudCommandRunner = runGcloudCommand,
): Promise<void> {
  const command = config.command ?? "gcloud";
  const version = await runner(command, ["--version"]);
  if (version.exitCode !== 0) {
    throw new Error(
      [
        `Local gcloud CLI is required for this workflow, but ${JSON.stringify(command)} could not be run.`,
        `Install it from ${config.installUrl ?? DEFAULT_GCLOUD_INSTALL_URL}, then rerun fdev.`,
        version.stderr || version.stdout,
      ].filter(Boolean).join("\n"),
    );
  }

  const token = await runner(command, authPrintAccessTokenArgs({ account: config.account }));
  if (token.exitCode !== 0 || !token.stdout.trim()) {
    throw new Error(
      [
        "Local gcloud is installed, but it is not authenticated.",
        "Run `gcloud auth login`, then rerun fdev.",
        token.stderr || token.stdout,
      ].filter(Boolean).join("\n"),
    );
  }
}

async function freshAccessToken(input: {
  config: GcloudConfigCopyConfig;
  store: GcloudAuthStore;
  runner: GcloudCommandRunner;
  options: GcloudFreshAccessTokenOptions;
}): Promise<GcloudAccessCredentials> {
  const command = input.config.command ?? "gcloud";
  const account = input.options.account ?? input.config.account;
  const token = await input.runner(command, authPrintAccessTokenArgs({ account }));
  if (token.exitCode !== 0 || !token.stdout.trim()) {
    throw new Error(
      [
        "Failed to mint a fresh gcloud access token from local gcloud.",
        "Run `gcloud auth login`, then rerun fdev.",
        token.stderr || token.stdout,
      ].filter(Boolean).join("\n"),
    );
  }

  const configuredAccount = account ?? await readConfiguredAccount(command, input.runner);
  const lifetimeSeconds = input.config.accessTokenLifetimeSeconds ?? DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
  const credentials = input.store.saveCredentials({
    key: input.options.key ?? input.config.key ?? DEFAULT_GCLOUD_CREDENTIAL_KEY,
    account: configuredAccount,
    scopes: normalizeScopes(input.options.scopes ?? input.config.scopes ?? DEFAULT_GCLOUD_AUTH_SCOPES),
    accessToken: token.stdout.trim(),
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + lifetimeSeconds * 1000).toISOString(),
  });

  return toAccessCredentials(credentials);
}

async function localGcloudConfigFiles(input: {
  config: GcloudConfigCopyConfig;
  runner: GcloudCommandRunner;
  options: GcloudConfigFilesOptions;
}): Promise<GcloudConfigCopy> {
  const command = input.config.command ?? "gcloud";
  const account = input.options.account ?? input.config.account ?? await readConfiguredAccount(command, input.runner);
  const configDir = resolveGcloudConfigDir(
    input.options.configDir ??
    input.config.configDir ??
    await readConfiguredGcloudConfigDir(command, input.runner),
  );
  const files = await readGcloudConfigFiles(configDir);
  if (files.length === 0) {
    throw new Error(`No copyable gcloud config files found in ${configDir}`);
  }

  return {
    sourceConfigDir: configDir,
    account,
    files,
  };
}

async function readConfiguredAccount(
  command: string,
  runner: GcloudCommandRunner,
): Promise<string | undefined> {
  const account = await runner(command, ["config", "get-value", "account", "--quiet"]);
  if (account.exitCode !== 0) return undefined;
  const value = account.stdout.trim();
  return value && value !== "(unset)" ? value : undefined;
}

async function readConfiguredGcloudConfigDir(
  command: string,
  runner: GcloudCommandRunner,
): Promise<string | undefined> {
  const result = await runner(command, ["info", "--format=value(config.paths.global_config_dir)", "--quiet"]);
  const value = result.stdout.trim();
  return result.exitCode === 0 && value ? value : undefined;
}

async function readGcloudConfigFiles(configDir: string): Promise<GcloudConfigCopy["files"]> {
  const root = resolve(configDir);
  const files: GcloudConfigCopy["files"] = [];

  async function visit(path: string): Promise<void> {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return;
    if (entry.isDirectory()) {
      const name = path.split(sep).at(-1);
      if (name && shouldSkipConfigDir(name)) return;
      const children = await readdir(path);
      await Promise.all(children.map((child) => visit(join(path, child))));
      return;
    }
    if (!entry.isFile()) return;

    const relativePath = relative(root, path).split(sep).join("/");
    if (!isSafeRelativePath(relativePath)) return;
    if (!shouldCopyConfigFile(relativePath)) return;

    files.push({
      path: relativePath,
      contentsBase64: Buffer.from(await readFile(path)).toString("base64"),
    });
  }

  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveGcloudConfigDir(configDir: string | undefined): string {
  if (configDir?.trim()) return resolve(expandHome(configDir.trim()));
  if (process.env.CLOUDSDK_CONFIG?.trim()) return resolve(expandHome(process.env.CLOUDSDK_CONFIG.trim()));
  return join(homedir(), ".config", "gcloud");
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function shouldSkipConfigDir(name: string): boolean {
  return (
    name === "logs" ||
    name === "cache" ||
    name === "virtenv" ||
    name === ".install" ||
    name === ".backup" ||
    name === "__pycache__"
  );
}

function shouldCopyConfigFile(path: string): boolean {
  return (
    path === "active_config" ||
    path === "application_default_credentials.json" ||
    path === "access_tokens.db" ||
    path.startsWith("access_tokens.db-") ||
    path === "credentials.db" ||
    path.startsWith("credentials.db-") ||
    path.startsWith("configurations/") ||
    path.startsWith("legacy_credentials/")
  );
}

function isSafeRelativePath(path: string): boolean {
  return Boolean(
    path &&
    !path.startsWith("/") &&
    !path.includes("\0") &&
    !path.includes("\n") &&
    !path.includes("\r") &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function authPrintAccessTokenArgs(input: { account?: string }): string[] {
  return [
    "auth",
    "print-access-token",
    "--quiet",
    ...(input.account ? ["--account", input.account] : []),
  ];
}

async function runGcloudCommand(command: string, args: readonly string[]): Promise<GcloudCommandResult> {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
    };
  }
}

function toAccessCredentials(credentials: GcloudStoredCredentials): GcloudAccessCredentials {
  return {
    accessToken: credentials.accessToken,
    tokenType: credentials.tokenType,
    expiresAt: credentials.expiresAt,
    account: credentials.account,
    scopes: credentials.scopes,
  };
}
