import type { ExecOptions } from "@freestyle-sh/fdev-sdk";
import { parseDurationMs, type DurationInput } from "./duration.ts";

export const DEFAULT_GCLOUD_ACCESS_TOKEN_PATH = "${HOME:-/root}/.config/fdev/gcloud/access-token";
export const DEFAULT_GCLOUD_ACCESS_TOKEN_EXPIRES_AT_PATH = "${HOME:-/root}/.config/fdev/gcloud/expires-at-ms";
export const DEFAULT_GCLOUD_CONFIG_DIR = "${HOME:-/root}/.config/gcloud";

export type GcloudAccessCredentials = {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  account?: string | null;
  scopes: string[];
};

export type GcloudAccessTokenInjectionOptions = {
  tokenPath?: string;
  expiresAtPath?: string;
};

export type GcloudAccessTokenInjection = {
  command: string;
  env: NonNullable<ExecOptions["env"]>;
};

export type GcloudConfigFile = {
  path: string;
  contentsBase64: string;
};

export type GcloudConfigCopy = {
  sourceConfigDir: string;
  account?: string | null;
  files: GcloudConfigFile[];
};

export type GcloudConfigCopyInjectionOptions = {
  configDir?: string;
  chunkSize?: number;
};

export type GcloudConfigCopyInjection = {
  command: string;
  env: NonNullable<ExecOptions["env"]>;
};

export type GcloudConfigCopyInjectionStep = GcloudConfigCopyInjection & {
  name: string;
};

export function gcloudAccessTokenInjection(
  credentials: GcloudAccessCredentials,
  options: GcloudAccessTokenInjectionOptions = {},
): GcloudAccessTokenInjection {
  const expiresAtMs = Date.parse(credentials.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error(`Invalid gcloud credential expiration ${JSON.stringify(credentials.expiresAt)}`);
  }

  return {
    command: [
      "set -e",
      'export HOME="${HOME:-/root}"',
      `token_path=${shellPathExpression(options.tokenPath, DEFAULT_GCLOUD_ACCESS_TOKEN_PATH)}`,
      `expires_at_path=${shellPathExpression(options.expiresAtPath, DEFAULT_GCLOUD_ACCESS_TOKEN_EXPIRES_AT_PATH)}`,
      'command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI is not installed" >&2; exit 1; }',
      'mkdir -p "$(dirname "$token_path")" "$(dirname "$expires_at_path")"',
      "umask 077",
      'printf "%s\\n" "$FDEV_GCLOUD_ACCESS_TOKEN" > "$token_path"',
      'printf "%s\\n" "$FDEV_GCLOUD_EXPIRES_AT_MS" > "$expires_at_path"',
      'gcloud config set auth/access_token_file "$token_path" >/dev/null',
      'if [ -n "${FDEV_GCLOUD_ACCOUNT:-}" ]; then',
      '  gcloud config set account "$FDEV_GCLOUD_ACCOUNT" >/dev/null',
      "fi",
    ].join("\n"),
    env: {
      FDEV_GCLOUD_ACCESS_TOKEN: credentials.accessToken,
      FDEV_GCLOUD_EXPIRES_AT: credentials.expiresAt,
      FDEV_GCLOUD_EXPIRES_AT_MS: String(expiresAtMs),
      FDEV_GCLOUD_ACCOUNT: credentials.account ?? undefined,
    },
  };
}

export function gcloudConfigCopyInjection(
  configCopy: GcloudConfigCopy,
  options: GcloudConfigCopyInjectionOptions = {},
): GcloudConfigCopyInjection {
  if (configCopy.files.length === 0) {
    throw new Error("Cannot copy empty gcloud config file set");
  }

  const env: NonNullable<ExecOptions["env"]> = {};
  const command = [
    "set -e",
    'export HOME="${HOME:-/root}"',
    `config_dir=${shellPathExpression(options.configDir, DEFAULT_GCLOUD_CONFIG_DIR)}`,
    'command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI is not installed" >&2; exit 1; }',
    'rm -rf "$config_dir"',
    'mkdir -p "$config_dir"',
    "umask 077",
  ];

  configCopy.files.forEach((file, index) => {
    assertSafeRelativePath(file.path);
    const variable = `FDEV_GCLOUD_CONFIG_FILE_${index}`;
    env[variable] = file.contentsBase64;
    command.push(
      `mkdir -p "$(dirname "$config_dir/${shellDoubleQuote(file.path)}")"`,
      `printf '%s' "$${variable}" | base64 -d > "$config_dir/${shellDoubleQuote(file.path)}"`,
      `chmod 600 "$config_dir/${shellDoubleQuote(file.path)}"`,
    );
  });
  if (configCopy.account) {
    env.FDEV_GCLOUD_ACCOUNT = configCopy.account;
    command.push(
      'export CLOUDSDK_CONFIG="$config_dir"',
      'gcloud config set account "$FDEV_GCLOUD_ACCOUNT" >/dev/null',
    );
  }

  return {
    command: command.join("\n"),
    env,
  };
}

export function gcloudConfigCopyInjectionSteps(
  configCopy: GcloudConfigCopy,
  options: GcloudConfigCopyInjectionOptions = {},
): GcloudConfigCopyInjectionStep[] {
  if (configCopy.files.length === 0) {
    throw new Error("Cannot copy empty gcloud config file set");
  }

  const chunkSize = normalizeChunkSize(options.chunkSize);
  const configDir = shellPathExpression(options.configDir, DEFAULT_GCLOUD_CONFIG_DIR);
  const steps: GcloudConfigCopyInjectionStep[] = [
    {
      name: "prepare gcloud config copy",
      command: [
        "set -e",
        'export HOME="${HOME:-/root}"',
        `config_dir=${configDir}`,
        'command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI is not installed" >&2; exit 1; }',
        'rm -rf "$config_dir"',
        'mkdir -p "$config_dir"',
      ].join("\n"),
      env: {},
    },
  ];

  configCopy.files.forEach((file, index) => {
    assertSafeRelativePath(file.path);
    const chunks = splitBase64(file.contentsBase64, chunkSize);
    chunks.forEach((chunk, chunkIndex) => {
      steps.push({
        name: `copy gcloud config file ${file.path} ${chunkIndex + 1}/${chunks.length}`,
        command: [
          "set -e",
          'export HOME="${HOME:-/root}"',
          `config_dir=${configDir}`,
          "umask 077",
          `mkdir -p "$(dirname "$config_dir/${shellDoubleQuote(file.path)}")"`,
          chunkIndex === 0 ? `: > "$config_dir/${shellDoubleQuote(file.path)}"` : "",
          `printf '%s' "$FDEV_GCLOUD_CONFIG_FILE_CHUNK" | base64 -d >> "$config_dir/${shellDoubleQuote(file.path)}"`,
          `chmod 600 "$config_dir/${shellDoubleQuote(file.path)}"`,
        ].filter(Boolean).join("\n"),
        env: {
          FDEV_GCLOUD_CONFIG_FILE_CHUNK: chunk,
        },
      });
    });
  });
  if (configCopy.account) {
    steps.push({
      name: "set copied gcloud account",
      command: [
        "set -e",
        'export HOME="${HOME:-/root}"',
        `config_dir=${configDir}`,
        'export CLOUDSDK_CONFIG="$config_dir"',
        'gcloud config set account "$FDEV_GCLOUD_ACCOUNT" >/dev/null',
      ].join("\n"),
      env: {
        FDEV_GCLOUD_ACCOUNT: configCopy.account,
      },
    });
  }

  return steps;
}

export function gcloudAccessTokenFreshCommand(
  options: GcloudAccessTokenInjectionOptions & { minExpiration?: DurationInput } = {},
): string {
  const minExpirationMs = parseDurationMs(options.minExpiration ?? 0);
  return [
    "set -e",
    'export HOME="${HOME:-/root}"',
    `expires_at_path=${shellPathExpression(options.expiresAtPath, DEFAULT_GCLOUD_ACCESS_TOKEN_EXPIRES_AT_PATH)}`,
    'test -s "$expires_at_path"',
    'expires_at_ms="$(cat "$expires_at_path")"',
    'case "$expires_at_ms" in ""|*[!0-9]*) exit 1;; esac',
    'now_ms="$(($(date +%s) * 1000))"',
    `test "$expires_at_ms" -gt "$((now_ms + ${minExpirationMs}))"`,
    "gcloud auth print-access-token >/dev/null 2>&1",
  ].join("\n");
}

export function gcloudCopiedConfigReadyCommand(): string {
  return [
    "set -e",
    'export HOME="${HOME:-/root}"',
    'gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .',
    "gcloud auth print-access-token >/dev/null 2>&1",
  ].join("\n");
}

function shellPathExpression(path: string | undefined, defaultExpression: string): string {
  return path ? shellQuote(path) : `"${defaultExpression}"`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellDoubleQuote(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`");
}

function normalizeChunkSize(value: number | undefined): number {
  const chunkSize = Math.floor(value ?? 16 * 1024);
  if (!Number.isFinite(chunkSize) || chunkSize < 4) {
    throw new Error(`Invalid gcloud config file chunk size ${JSON.stringify(value)}`);
  }
  return chunkSize - (chunkSize % 4);
}

function splitBase64(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}

function assertSafeRelativePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.includes("\n") ||
    path.includes("\r") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe gcloud config file path ${JSON.stringify(path)}`);
  }
}
