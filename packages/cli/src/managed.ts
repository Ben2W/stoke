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
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createManagedClient,
  type ManagedClient,
  type ProjectSource,
} from "@stoke/managed";

export const DEFAULT_STOKE_API_URL = "https://usestoke.dev";

export type ManagedEnvironment = Record<string, string | undefined>;

export type StokeCredential = {
  accessToken: string;
  expiresAt?: string;
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
): ManagedClient {
  const token = environment.STOKE_TOKEN?.trim() || readStokeCredential(environment)?.accessToken;
  if (!token) {
    throw new Error("Stoke is not authenticated. Run `stoke login` first.");
  }

  return createManagedClient({
    baseUrl: stokeApiUrl(environment),
    token,
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
  return join(environment.STOKE_HOME?.trim() || join(homedir(), ".stoke"), "credentials.json");
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
  } = {},
): { name: string; source: ProjectSource } {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const localPath = resolve(cwd, input);

  if (existsSync(localPath)) {
    if (!statSync(localPath).isDirectory()) {
      throw new Error(`Local Stoke project source must be a directory: ${localPath}`);
    }
    const path = realpathSync(localPath);
    return {
      name: basename(path),
      source: {
        kind: "local",
        machineId: environment.STOKE_MACHINE_ID?.trim() || hostname(),
        machineName: environment.STOKE_MACHINE_NAME?.trim() || hostname(),
        path,
      },
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
