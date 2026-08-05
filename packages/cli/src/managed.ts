import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createManagedClient,
  type ManagedCheckout,
  type ManagedClient,
  type ManagedProject,
  type ProjectSource,
} from "@usestoke/managed";

export const DEFAULT_STOKE_API_URL = "https://usestoke.dev";

export type ManagedEnvironment = Record<string, string | undefined>;

export type StokeCredential = {
  accessToken: string;
  expiresAt?: string;
};

export type StokeSettings = {
  deviceId: string;
  deviceName: string;
  currentProjectId?: string;
};

export type StokeDeviceIdentity = {
  id: string;
  name: string;
};

export type ResolvedProjectSource = {
  name: string;
  source: ProjectSource;
  checkout?: {
    path: string;
    gitRemote?: string;
  };
};

export type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export class DeviceAuthorizationError extends Error {
  override name = "DeviceAuthorizationError";

  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function managedClientFromEnvironment(
  environment: ManagedEnvironment = process.env,
  options: { onUnauthorized?: () => Promise<string | undefined> } = {},
): ManagedClient {
  const token = () => environment.STOKE_TOKEN?.trim() || readStokeCredential(environment)?.accessToken;
  if (!token() && !options.onUnauthorized) {
    throw new Error("Stoke is not authenticated. Run `stoke login` first.");
  }

  return createManagedClient({
    baseUrl: stokeApiUrl(environment),
    token,
    onUnauthorized: options.onUnauthorized,
  });
}

export function stokeApiUrl(environment: ManagedEnvironment = process.env): string {
  return (environment.STOKE_API_URL?.trim() || DEFAULT_STOKE_API_URL).replace(/\/+$/, "");
}

export async function requestDeviceAuthorization(
  environment: ManagedEnvironment = process.env,
): Promise<DeviceAuthorization> {
  return await authRequest<DeviceAuthorization>(environment, "/api/auth/device/code", {
    client_id: "stoke-cli",
    scope: "openid profile email",
  });
}

export async function exchangeDeviceAuthorization(
  deviceCode: string,
  environment: ManagedEnvironment = process.env,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch(`${stokeApiUrl(environment)}/api/auth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: "stoke-cli",
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new DeviceAuthorizationError(
      typeof body.error === "string" ? body.error : "device_authorization_failed",
      typeof body.error_description === "string" ? body.error_description : "Device authorization failed",
    );
  }
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new Error("Stoke returned an invalid device token response");
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

export async function revokeStokeSession(
  credential: StokeCredential,
  environment: ManagedEnvironment = process.env,
): Promise<void> {
  await fetch(`${stokeApiUrl(environment)}/api/auth/sign-out`, {
    method: "POST",
    headers: { authorization: `Bearer ${credential.accessToken}` },
  }).catch(() => undefined);
}

export function readStokeCredential(
  environment: ManagedEnvironment = process.env,
): StokeCredential | undefined {
  const path = credentialPath(environment);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StokeCredential>;
    if (typeof parsed.accessToken !== "string" || !parsed.accessToken) return undefined;
    return {
      accessToken: parsed.accessToken,
      ...(typeof parsed.expiresAt === "string" ? { expiresAt: parsed.expiresAt } : {}),
    };
  } catch {
    return undefined;
  }
}

export function writeStokeCredential(
  credential: StokeCredential,
  environment: ManagedEnvironment = process.env,
): void {
  const path = credentialPath(environment);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearStokeCredential(environment: ManagedEnvironment = process.env): void {
  rmSync(credentialPath(environment), { force: true });
}

function credentialPath(environment: ManagedEnvironment): string {
  return join(stokeHome(environment), "credentials.json");
}

export function readStokeSettings(
  environment: ManagedEnvironment = process.env,
): StokeSettings | undefined {
  const path = settingsPath(environment);
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<StokeSettings>;
    if (typeof value.deviceId !== "string" || typeof value.deviceName !== "string") return undefined;
    return {
      deviceId: value.deviceId,
      deviceName: value.deviceName,
      ...(typeof value.currentProjectId === "string" ? { currentProjectId: value.currentProjectId } : {}),
    };
  } catch {
    return undefined;
  }
}

export function ensureStokeDevice(
  environment: ManagedEnvironment = process.env,
): StokeDeviceIdentity {
  const existing = readStokeSettings(environment);
  const id = environment.STOKE_DEVICE_ID?.trim()
    || environment.STOKE_MACHINE_ID?.trim()
    || existing?.deviceId
    || randomUUID();
  const name = environment.STOKE_DEVICE_NAME?.trim()
    || environment.STOKE_MACHINE_NAME?.trim()
    || existing?.deviceName
    || hostname();
  if (!existing || existing.deviceId !== id || existing.deviceName !== name) {
    writeStokeSettings({
      deviceId: id,
      deviceName: name,
      ...(existing?.currentProjectId ? { currentProjectId: existing.currentProjectId } : {}),
    }, environment);
  }
  return { id, name };
}

export function setCurrentProject(
  projectId: string | undefined,
  environment: ManagedEnvironment = process.env,
): StokeSettings {
  const device = ensureStokeDevice(environment);
  const settings: StokeSettings = {
    deviceId: device.id,
    deviceName: device.name,
    ...(projectId ? { currentProjectId: projectId } : {}),
  };
  writeStokeSettings(settings, environment);
  return settings;
}

function writeStokeSettings(
  settings: StokeSettings,
  environment: ManagedEnvironment,
): void {
  const path = settingsPath(environment);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function settingsPath(environment: ManagedEnvironment): string {
  return join(stokeHome(environment), "config.json");
}

function stokeHome(environment: ManagedEnvironment): string {
  return environment.STOKE_HOME?.trim() || join(homedir(), ".stoke");
}

async function authRequest<T>(
  environment: ManagedEnvironment,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${stokeApiUrl(environment)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof value.error_description === "string"
        ? value.error_description
        : `Stoke authentication failed with ${response.status}`,
    );
  }
  return value as T;
}

export function resolveProjectSource(
  input: string,
  options: {
    cwd?: string;
    environment?: ManagedEnvironment;
    device?: StokeDeviceIdentity;
  } = {},
): ResolvedProjectSource {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const localPath = resolve(cwd, input);

  if (existsSync(localPath)) {
    if (!statSync(localPath).isDirectory()) {
      throw new Error(`Local Stoke project source must be a directory: ${localPath}`);
    }
    const path = realpathSync(localPath);
    const gitRemote = readGitRemote(path);
    const repository = gitRemote ? parseGitHubRepository(gitRemote) : undefined;
    if (repository) {
      return {
        name: repository.repository,
        source: {
          kind: "github",
          ...repository,
          url: `https://github.com/${repository.owner}/${repository.repository}`,
        },
        checkout: { path, gitRemote },
      };
    }
    const device = options.device ?? {
      id: environment.STOKE_DEVICE_ID?.trim() || environment.STOKE_MACHINE_ID?.trim() || hostname(),
      name: environment.STOKE_DEVICE_NAME?.trim() || environment.STOKE_MACHINE_NAME?.trim() || hostname(),
    };
    return {
      name: basename(path),
      source: {
        kind: "local",
        machineId: device.id,
        machineName: device.name,
        path,
      },
      checkout: { path, ...(gitRemote ? { gitRemote } : {}) },
    };
  }

  const repository = parseGitHubRepository(input);
  if (!repository) {
    throw new Error(
      `Could not resolve ${JSON.stringify(input)}. Pass an existing local directory or a GitHub repository such as owner/repo.`,
    );
  }

  return {
    name: repository.repository,
    source: {
      kind: "github",
      ...repository,
      url: `https://github.com/${repository.owner}/${repository.repository}`,
    },
  };
}

export function resolveManagedProjectSelector(
  selector: string,
  projects: ManagedProject[],
  checkouts: ManagedCheckout[],
  options: { cwd?: string; deviceId?: string } = {},
): ManagedProject {
  const value = selector.trim();
  const direct = projects.find((project) => project.id === value || project.slug === value);
  if (direct) return direct;

  const localPath = resolve(options.cwd ?? process.cwd(), value);
  if (existsSync(localPath)) {
    const path = realpathSync(localPath);
    const checkout = checkouts.find((candidate) =>
      candidate.path === path && (!options.deviceId || candidate.deviceId === options.deviceId)
    );
    if (checkout) {
      const project = projects.find((candidate) => candidate.id === checkout.projectId);
      if (project) return project;
    }
  }

  const repository = parseGitHubRepository(value);
  if (repository) {
    const project = projects.find((candidate) =>
      candidate.source.kind === "github"
      && candidate.source.owner.toLowerCase() === repository.owner.toLowerCase()
      && candidate.source.repository.toLowerCase() === repository.repository.toLowerCase()
    );
    if (project) return project;
  }

  const named = projects.filter((project) => project.name.toLowerCase() === value.toLowerCase());
  if (named.length === 1) return named[0]!;
  if (named.length > 1) {
    throw new Error(
      `Project name ${JSON.stringify(selector)} is ambiguous. Use one of: ${named.map((project) => project.slug).join(", ")}`,
    );
  }
  throw new Error(`Managed project ${JSON.stringify(selector)} was not found. Run \`stoke project ls\` to see projects.`);
}

function readGitRemote(path: string): string | undefined {
  try {
    const value = execFileSync("git", ["-C", path, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function parseGitHubRepository(
  value: string,
): { owner: string; repository: string } | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|github\.com\/)?([^/\s:]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return { owner: match[1], repository: match[2] };
}
