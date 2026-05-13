import { createHash } from "node:crypto";
import { Freestyle } from "freestyle";
import type { LocalWorkspaceRuntime, ProviderStorage } from "@rigkit/engine";
import type { JsonValue } from "@rigkit/sdk";
import { freestyleIdentityId, freestyleToken, freestyleTokenId } from "./auth.ts";
import { createFreestyleStore } from "./store.ts";

const DEFAULT_STACK_API_URL = "https://api.stack-auth.com";
const DEFAULT_STACK_APP_URL = "https://dash.freestyle.sh";
const DEFAULT_STACK_PROJECT_ID = "0edf478c-f123-46fb-818f-34c0024a9f35";
const DEFAULT_STACK_PUBLISHABLE_CLIENT_KEY = "pck_h2aft7g9pqjzrkdnzs199h1may5wjtdtdxeex7m2wzp1r";
const DEFAULT_CLI_AUTH_TIMEOUT_MILLIS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MILLIS = 2000;

export type FreestyleProviderAuthConfig = {
  apiKey?: string;
  profile?: string;
  teamId?: string;
  apiUrl?: string;
  dashboardUrl?: string;
  stackApiUrl?: string;
  stackAppUrl?: string;
  stackProjectId?: string;
  stackPublishableClientKey?: string;
};

export type FreestyleAuthenticatedClient = {
  client: Freestyle;
  identityId: ReturnType<typeof freestyleIdentityId>;
  tokenId: ReturnType<typeof freestyleTokenId>;
  token: ReturnType<typeof freestyleToken>;
};

type CreateFreestyleAuthenticatedClientInput = {
  auth?: FreestyleProviderAuthConfig;
  hostStorage: ProviderStorage;
  local: LocalWorkspaceRuntime;
  fetch?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type ResolvedClientAuth = {
  client: Freestyle;
  identityKey: string;
};

type StackAuthConfig = {
  stackApiUrl: string;
  appUrl: string;
  dashboardUrl: string;
  projectId: string;
  publishableClientKey: string;
  profile: string;
};

type StackAuthState = {
  refreshToken: string;
  updatedAt: number;
  defaultTeamId?: string;
  accessToken?: string;
  accessTokenUpdatedAt?: number;
};

type StackTokenRefresh = {
  accessToken: string;
  refreshToken?: string;
};

type FreestyleTeam = {
  id: string;
  displayName?: string;
  sandboxAccountId?: string | null;
};

export async function createFreestyleAuthenticatedClient(
  input: CreateFreestyleAuthenticatedClientInput,
): Promise<FreestyleAuthenticatedClient> {
  const auth = await resolveClientAuth(input);
  const store = createFreestyleStore(input.hostStorage);
  const savedIdentity = store.getIdentity(auth.identityKey);
  if (savedIdentity) {
    return {
      client: auth.client,
      identityId: savedIdentity.identityId,
      tokenId: savedIdentity.tokenId,
      token: savedIdentity.token,
    };
  }

  const { identity, identityId } = await auth.client.identities.create();
  const { token, tokenId } = await identity.tokens.create();
  const createdIdentity = store.saveIdentity({
    key: auth.identityKey,
    identityId: freestyleIdentityId(identityId),
    tokenId: freestyleTokenId(tokenId),
    token: freestyleToken(token),
  });

  return {
    client: auth.client,
    identityId: createdIdentity.identityId,
    tokenId: createdIdentity.tokenId,
    token: createdIdentity.token,
  };
}

export function createFreestyleProxyFetch(input: {
  dashboardUrl: string;
  accessToken: string;
  teamId: string;
  fetch?: typeof fetch;
}): typeof fetch {
  const fetchFn = input.fetch ?? globalThis.fetch;
  const dashboardUrl = trimTrailingSlash(input.dashboardUrl);

  const proxyFetch = async (resource: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = resourceUrl(resource);
    const path = `${url.pathname}${url.search}`.replace(/^\/+/, "");
    const proxyResponse = await fetchFn(`${dashboardUrl}/api/proxy/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          accessToken: input.accessToken,
          teamId: input.teamId,
          path,
          method: init?.method ?? "GET",
          headers: init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {},
          body: init?.body ? String(init.body) : undefined,
        },
      }),
    });

    if (!proxyResponse.ok) {
      const errorText = await proxyResponse.text();
      const normalized = normalizeProxyError(errorText, proxyResponse.status);
      return new Response(normalized.body, {
        status: proxyResponse.status,
        statusText: proxyResponse.statusText,
        headers: { "Content-Type": normalized.contentType },
      });
    }

    const data = await proxyResponse.json();
    if (isBackgroundRequestPending(data)) {
      const requestId = backgroundRequestId(data);
      return Response.json(data, {
        status: 202,
        headers: {
          ...(requestId ? { "x-freestyle-background-request-id": requestId } : {}),
        },
      });
    }
    return Response.json(data);
  };

  return Object.assign(proxyFetch, {
    preconnect: fetchFn.preconnect?.bind(fetchFn) ?? (() => {}),
  }) as typeof fetch;
}

async function resolveClientAuth(input: CreateFreestyleAuthenticatedClientInput): Promise<ResolvedClientAuth> {
  const apiKey = nonEmpty(input.auth?.apiKey);
  const apiUrl = nonEmpty(input.auth?.apiUrl) ?? nonEmpty(process.env.FREESTYLE_API_URL);
  const fetchFn = input.fetch ?? globalThis.fetch;

  if (apiKey) {
    return {
      client: new Freestyle({
        apiKey,
        ...(apiUrl ? { baseUrl: apiUrl } : {}),
        fetch: fetchFn,
      }),
      identityKey: `api-key:${fingerprint({ apiUrl: apiUrl ?? "default", apiKey })}`,
    };
  }

  const stack = resolveStackAuthConfig(input.auth);
  const stackStateKey = stackAuthStateKey(stack);
  const stored = readStackAuthState(input.hostStorage.get(stackStateKey)?.value);
  const refreshed = await resolveStackAccessToken({
    config: stack,
    storage: input.hostStorage,
    storageKey: stackStateKey,
    stored,
    local: input.local,
    fetch: fetchFn,
    timeoutMs: input.timeoutMs ?? DEFAULT_CLI_AUTH_TIMEOUT_MILLIS,
    pollIntervalMs: input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MILLIS,
  });
  const teamId = await resolveTeamId({
    configuredTeamId: input.auth?.teamId,
    stored: readStackAuthState(input.hostStorage.get(stackStateKey)?.value) ?? stored,
    accessToken: refreshed.accessToken,
    config: stack,
    storage: input.hostStorage,
    storageKey: stackStateKey,
    fetch: fetchFn,
  });
  const client = new Freestyle({
    apiKey: "rigkit-browser-auth",
    ...(apiUrl ? { baseUrl: apiUrl } : {}),
    fetch: createFreestyleProxyFetch({
      dashboardUrl: stack.dashboardUrl,
      accessToken: refreshed.accessToken,
      teamId,
      fetch: fetchFn,
    }),
  });

  return {
    client,
    identityKey: `browser:${fingerprint({
      apiUrl: apiUrl ?? "default",
      dashboardUrl: stack.dashboardUrl,
      profile: stack.profile,
      teamId,
    })}`,
  };
}

function resolveStackAuthConfig(auth: FreestyleProviderAuthConfig | undefined): StackAuthConfig {
  const dashboardUrl = trimTrailingSlash(
    nonEmpty(auth?.dashboardUrl) ??
      nonEmpty(process.env.FREESTYLE_DASHBOARD_URL) ??
      DEFAULT_STACK_APP_URL,
  );
  return {
    stackApiUrl: trimTrailingSlash(
      nonEmpty(auth?.stackApiUrl) ??
        nonEmpty(process.env.FREESTYLE_STACK_API_URL) ??
        DEFAULT_STACK_API_URL,
    ),
    appUrl: trimTrailingSlash(
      nonEmpty(auth?.stackAppUrl) ??
        nonEmpty(process.env.FREESTYLE_STACK_APP_URL) ??
        dashboardUrl,
    ),
    dashboardUrl,
    projectId:
      nonEmpty(auth?.stackProjectId) ??
        nonEmpty(process.env.FREESTYLE_STACK_PROJECT_ID) ??
        nonEmpty(process.env.NEXT_PUBLIC_STACK_PROJECT_ID) ??
        nonEmpty(process.env.VITE_STACK_PROJECT_ID) ??
        DEFAULT_STACK_PROJECT_ID,
    publishableClientKey:
      nonEmpty(auth?.stackPublishableClientKey) ??
        nonEmpty(process.env.FREESTYLE_STACK_PUBLISHABLE_CLIENT_KEY) ??
        nonEmpty(process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY) ??
        nonEmpty(process.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY) ??
        DEFAULT_STACK_PUBLISHABLE_CLIENT_KEY,
    profile: nonEmpty(auth?.profile) ?? "default",
  };
}

async function resolveStackAccessToken(input: {
  config: StackAuthConfig;
  storage: ProviderStorage;
  storageKey: string;
  stored: StackAuthState | undefined;
  local: LocalWorkspaceRuntime;
  fetch: typeof fetch;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<StackTokenRefresh> {
  let refreshToken = input.stored?.refreshToken;
  if (!refreshToken) {
    refreshToken = await startCliLogin(input);
    saveStackAuthState(input.storage, input.storageKey, {
      refreshToken,
      defaultTeamId: input.stored?.defaultTeamId,
      updatedAt: Date.now(),
    });
  }

  let refreshed = await refreshStackAccessToken(input.config, refreshToken, input.fetch);
  if (!refreshed) {
    input.storage.delete(input.storageKey);
    refreshToken = await startCliLogin(input);
    saveStackAuthState(input.storage, input.storageKey, {
      refreshToken,
      defaultTeamId: input.stored?.defaultTeamId,
      updatedAt: Date.now(),
    });
    refreshed = await refreshStackAccessToken(input.config, refreshToken, input.fetch);
  }

  if (!refreshed) {
    throw new Error("Failed to authenticate with Freestyle.");
  }

  const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
  saveStackAuthState(input.storage, input.storageKey, {
    refreshToken: nextRefreshToken,
    defaultTeamId: input.stored?.defaultTeamId,
    accessToken: refreshed.accessToken,
    accessTokenUpdatedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return refreshed;
}

async function startCliLogin(input: {
  config: StackAuthConfig;
  local: LocalWorkspaceRuntime;
  fetch: typeof fetch;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<string> {
  const initResponse = await input.fetch(`${input.config.stackApiUrl}/api/v1/auth/cli`, {
    method: "POST",
    headers: stackClientHeaders(input.config),
    body: JSON.stringify({
      expires_in_millis: input.timeoutMs,
    }),
  });
  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(
      `Failed to start Freestyle authentication (${initResponse.status}). ${errorText || "Check Stack Auth configuration."}`,
    );
  }

  const initData = await initResponse.json() as Record<string, unknown>;
  const pollingCode = stringField(initData, "polling_code");
  const loginCode = stringField(initData, "login_code");
  const loginUrl = `${input.config.appUrl}/handler/cli-auth-confirm?login_code=${encodeURIComponent(loginCode)}`;

  console.log(`Freestyle authentication required. Opening ${loginUrl}`);
  try {
    await input.local.open(loginUrl);
  } catch {
    console.log(`Open this URL to authenticate with Freestyle:\n${loginUrl}`);
  }

  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const pollResponse = await input.fetch(`${input.config.stackApiUrl}/api/v1/auth/cli/poll`, {
      method: "POST",
      headers: stackClientHeaders(input.config),
      body: JSON.stringify({
        polling_code: pollingCode,
      }),
    });
    if (![200, 201].includes(pollResponse.status)) {
      throw new Error(`Failed while polling Freestyle authentication (${pollResponse.status}).`);
    }

    const pollData = await pollResponse.json() as Record<string, unknown>;
    const status = typeof pollData.status === "string" ? pollData.status : "pending";
    if (status === "completed" || status === "success") {
      return stringField(pollData, "refresh_token");
    }
    if (status !== "pending" && status !== "waiting") {
      throw new Error(
        typeof pollData.error === "string"
          ? pollData.error
          : `Freestyle authentication ${status}. Please retry.`,
      );
    }

    await sleep(input.pollIntervalMs);
  }

  throw new Error("Timed out waiting for Freestyle authentication.");
}

async function refreshStackAccessToken(
  config: StackAuthConfig,
  refreshToken: string,
  fetchFn: typeof fetch,
): Promise<StackTokenRefresh | null> {
  const response = await fetchFn(`${config.stackApiUrl}/api/v1/auth/sessions/current/refresh`, {
    method: "POST",
    headers: {
      ...stackClientHeaders(config),
      "x-stack-refresh-token": refreshToken,
    },
    body: "{}",
  });
  if (!response.ok) return null;
  const data = await response.json() as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : undefined;
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
  };
}

async function resolveTeamId(input: {
  configuredTeamId: string | undefined;
  stored: StackAuthState | undefined;
  accessToken: string;
  config: StackAuthConfig;
  storage: ProviderStorage;
  storageKey: string;
  fetch: typeof fetch;
}): Promise<string> {
  const teamId =
    nonEmpty(input.configuredTeamId) ??
      nonEmpty(process.env.FREESTYLE_TEAM_ID) ??
      nonEmpty(input.stored?.defaultTeamId);
  if (teamId) {
    saveStackAuthState(input.storage, input.storageKey, {
      ...input.stored,
      refreshToken: input.stored?.refreshToken ?? "",
      defaultTeamId: teamId,
      updatedAt: Date.now(),
    });
    return teamId;
  }

  const teams = await listTeams(input.config, input.accessToken, input.fetch);
  if (teams.length === 1) {
    const onlyTeam = teams[0]!;
    saveStackAuthState(input.storage, input.storageKey, {
      ...input.stored,
      refreshToken: input.stored?.refreshToken ?? "",
      defaultTeamId: onlyTeam.id,
      updatedAt: Date.now(),
    });
    return onlyTeam.id;
  }

  if (teams.length === 0) {
    throw new Error("Freestyle authentication succeeded, but no teams were available for this account.");
  }

  const choices = teams.map((team) => `${team.displayName ?? team.id} (${team.id})`).join(", ");
  throw new Error(
    `Freestyle authentication found multiple teams. Set freestyle.provider({ auth: { teamId } }) or FREESTYLE_TEAM_ID. Teams: ${choices}`,
  );
}

async function listTeams(config: StackAuthConfig, accessToken: string, fetchFn: typeof fetch): Promise<FreestyleTeam[]> {
  const response = await fetchFn(`${config.dashboardUrl}/api/cli/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: { accessToken },
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to list Freestyle teams (${response.status}). ${await response.text()}`);
  }
  const data = await response.json() as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Freestyle team list response was invalid.");
  }
  return data.filter(isFreestyleTeam);
}

function stackClientHeaders(config: StackAuthConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-stack-project-id": config.projectId,
    "x-stack-access-type": "client",
    "x-stack-publishable-client-key": config.publishableClientKey,
  };
}

function stackAuthStateKey(config: StackAuthConfig): string {
  return `stack-auth:${fingerprint({
    stackApiUrl: config.stackApiUrl,
    appUrl: config.appUrl,
    projectId: config.projectId,
    profile: config.profile,
  })}`;
}

function readStackAuthState(value: JsonValue | undefined): StackAuthState | undefined {
  if (!isRecord(value)) return undefined;
  const refreshToken = typeof value.refreshToken === "string" ? value.refreshToken : undefined;
  if (!refreshToken) return undefined;
  return {
    refreshToken,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    defaultTeamId: typeof value.defaultTeamId === "string" ? value.defaultTeamId : undefined,
    accessToken: typeof value.accessToken === "string" ? value.accessToken : undefined,
    accessTokenUpdatedAt: typeof value.accessTokenUpdatedAt === "number" ? value.accessTokenUpdatedAt : undefined,
  };
}

function saveStackAuthState(storage: ProviderStorage, key: string, state: StackAuthState): void {
  if (!state.refreshToken) return;
  storage.set(key, {
    refreshToken: state.refreshToken,
    updatedAt: state.updatedAt,
    ...(state.defaultTeamId ? { defaultTeamId: state.defaultTeamId } : {}),
    ...(state.accessToken ? { accessToken: state.accessToken } : {}),
    ...(state.accessTokenUpdatedAt ? { accessTokenUpdatedAt: state.accessTokenUpdatedAt } : {}),
  });
}

function resourceUrl(resource: Parameters<typeof fetch>[0]): URL {
  if (typeof resource === "string") return new URL(resource);
  if (resource instanceof URL) return resource;
  return new URL(resource.url);
}

function normalizeProxyError(errorText: string, status: number): { body: string; contentType: string } {
  const fallbackCode = status === 400
    ? "BAD_REQUEST"
    : status === 401
      ? "UNAUTHORIZED_ERROR"
      : status === 403
        ? "FORBIDDEN"
        : "INTERNAL_ERROR";
  try {
    const parsed = JSON.parse(errorText) as Record<string, unknown>;
    if (typeof parsed.code === "string" && typeof parsed.message === "string") {
      return { body: JSON.stringify(parsed), contentType: "application/json" };
    }
    const message = [parsed.error, parsed.message, parsed.reason].find((value) =>
      typeof value === "string" && value.length > 0
    );
    if (typeof message === "string") {
      return {
        body: JSON.stringify({ code: fallbackCode, message }),
        contentType: "application/json",
      };
    }
  } catch {
    // Keep the non-JSON text below.
  }
  return {
    body: JSON.stringify({ code: fallbackCode, message: errorText || "Request failed" }),
    contentType: "application/json",
  };
}

function isBackgroundRequestPending(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
      (value.status === "pending" || value.status === "running") &&
      (typeof value.requestId === "string" || typeof value.request_id === "string")
  );
}

function backgroundRequestId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.requestId === "string"
    ? value.requestId
    : typeof value.request_id === "string"
      ? value.request_id
      : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Freestyle authentication response did not include ${key}.`);
  }
  return value;
}

function isFreestyleTeam(value: unknown): value is FreestyleTeam {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { id?: unknown }).id === "string"
  );
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
