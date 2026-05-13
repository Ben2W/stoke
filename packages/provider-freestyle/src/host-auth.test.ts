import { afterEach, describe, expect, test } from "bun:test";
import type {
  JsonValue,
  ProviderRuntimeContext,
  ProviderStorage,
  ProviderStorageRecord,
  WorkflowProviderController,
  WorkflowEvent,
} from "@rigkit/engine";
import { FREESTYLE_PROVIDER_ID, freestyleProviderPlugin } from "./index.ts";
import type { FreestyleRuntime } from "./provider.ts";

const originalFreestyleApiKey = process.env.FREESTYLE_API_KEY;
const originalFreestyleTeamId = process.env.FREESTYLE_TEAM_ID;

afterEach(() => {
  setEnv("FREESTYLE_API_KEY", originalFreestyleApiKey);
  setEnv("FREESTYLE_TEAM_ID", originalFreestyleTeamId);
});

describe("Freestyle provider host auth", () => {
  test("uses explicit API-key auth and stores identity tokens in host storage", async () => {
    process.env.FREESTYLE_API_KEY = "ignored-env-api-key";
    delete process.env.FREESTYLE_TEAM_ID;

    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = testFetch((resource, init) => {
      const url = resourceUrl(resource);
      const method = init?.method ?? "GET";
      const authorization = new Headers(init?.headers).get("authorization");
      requests.push({ url: url.href, method, authorization });
      if (url.pathname === "/identity/v1/identities" && method === "POST") {
        return Response.json({ id: "identity-api-key" });
      }
      if (url.pathname === "/identity/v1/identities/identity-api-key/tokens" && method === "POST") {
        return Response.json({ id: "token-id-api-key", token: "ssh-token-api-key" });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    });

    try {
      const controller = await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: {
            image: "node-22",
            auth: { apiKey: "object-api-key" },
          },
        },
        storage: projectStorage,
        hostStorage,
        local: { open: async () => {} },
      });

      expect(projectStorage.entries()).toEqual([]);
      expect(hostStorage.entries("identity:")).toHaveLength(1);
      expect(requests).toHaveLength(2);

      const runtime = await (controller as WorkflowProviderController<FreestyleRuntime>).runtime(providerContext([]));

      expect(runtime.client).toBeDefined();
      expect(hostStorage.entries("identity:")[0]?.value).toMatchObject({
        identityId: "identity-api-key",
        tokenId: "token-id-api-key",
        token: "ssh-token-api-key",
      });
      expect(requests).toEqual([
        {
          url: "https://api.freestyle.sh/identity/v1/identities",
          method: "POST",
          authorization: "Bearer object-api-key",
        },
        {
          url: "https://api.freestyle.sh/identity/v1/identities/identity-api-key/tokens",
          method: "POST",
          authorization: "Bearer object-api-key",
        },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("runs browser auth through provider host storage and proxies SDK requests by team", async () => {
    delete process.env.FREESTYLE_API_KEY;
    delete process.env.FREESTYLE_TEAM_ID;

    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const opened: string[] = [];
    const proxyRequests: unknown[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = testFetch(async (resource, init) => {
      const url = resourceUrl(resource);
      if (url.href === "https://api.stack-auth.com/api/v1/auth/cli") {
        return Response.json({ polling_code: "poll-code", login_code: "login-code" });
      }
      if (url.href === "https://api.stack-auth.com/api/v1/auth/cli/poll") {
        return Response.json({ status: "completed", refresh_token: "refresh-token" });
      }
      if (url.href === "https://api.stack-auth.com/api/v1/auth/sessions/current/refresh") {
        return Response.json({ access_token: "stack-access-token", refresh_token: "refresh-token-rotated" });
      }
      if (url.href === "https://dash.freestyle.sh/api/proxy/request") {
        const body = JSON.parse(String(init?.body));
        proxyRequests.push(body);
        if (body.data.path === "identity/v1/identities") {
          return Response.json({ id: "identity-browser" });
        }
        if (body.data.path === "identity/v1/identities/identity-browser/tokens") {
          return Response.json({ id: "token-id-browser", token: "ssh-token-browser" });
        }
      }
      return Response.json({ error: "unexpected request", url: url.href }, { status: 500 });
    });

    try {
      const controller = await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: {
            image: "node-22",
            auth: {
              teamId: "team_123",
            },
          },
        },
        storage: projectStorage,
        hostStorage,
        local: {
          open: async (target) => {
            opened.push(target);
          },
        },
      });

      expect(opened).toEqual([
        "https://dash.freestyle.sh/handler/cli-auth-confirm?login_code=login-code",
      ]);
      expect(projectStorage.entries()).toEqual([]);
      expect(hostStorage.entries("stack-auth:")[0]?.value).toMatchObject({
        refreshToken: "refresh-token-rotated",
        accessToken: "stack-access-token",
        defaultTeamId: "team_123",
      });

      await controller.runtime(providerContext([]));

      expect(hostStorage.entries("identity:")[0]?.value).toMatchObject({
        identityId: "identity-browser",
        tokenId: "token-id-browser",
        token: "ssh-token-browser",
      });
      expect(proxyRequests).toEqual([
        {
          data: {
            accessToken: "stack-access-token",
            teamId: "team_123",
            path: "identity/v1/identities",
            method: "POST",
            headers: expect.any(Object),
          },
        },
        {
          data: {
            accessToken: "stack-access-token",
            teamId: "team_123",
            path: "identity/v1/identities/identity-browser/tokens",
            method: "POST",
            headers: expect.any(Object),
          },
        },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("ignores ambient FREESTYLE_API_KEY unless API-key auth is configured", async () => {
    process.env.FREESTYLE_API_KEY = "stale-api-key";
    delete process.env.FREESTYLE_TEAM_ID;

    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const opened: string[] = [];
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = testFetch(async (resource, init) => {
      const url = resourceUrl(resource);
      requests.push({
        url: url.href,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.href === "https://api.stack-auth.com/api/v1/auth/cli") {
        return Response.json({ polling_code: "poll-code", login_code: "login-code" });
      }
      if (url.href === "https://api.stack-auth.com/api/v1/auth/cli/poll") {
        return Response.json({ status: "completed", refresh_token: "refresh-token" });
      }
      if (url.href === "https://api.stack-auth.com/api/v1/auth/sessions/current/refresh") {
        return Response.json({ access_token: "stack-access-token", refresh_token: "refresh-token" });
      }
      if (url.href === "https://dash.freestyle.sh/api/proxy/request") {
        const body = JSON.parse(String(init?.body));
        if (body.data.path === "api/cli/teams") {
          return Response.json([{ id: "team_123", displayName: "Team" }]);
        }
        if (body.data.path === "identity/v1/identities") {
          return Response.json({ id: "identity-browser" });
        }
        if (body.data.path === "identity/v1/identities/identity-browser/tokens") {
          return Response.json({ id: "token-id-browser", token: "ssh-token-browser" });
        }
      }
      if (url.href === "https://dash.freestyle.sh/api/cli/teams") {
        return Response.json([{ id: "team_123", displayName: "Team" }]);
      }
      return Response.json({ error: "unexpected request", url: url.href }, { status: 500 });
    });

    try {
      await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: { image: "node-22" },
        },
        storage: projectStorage,
        hostStorage,
        local: {
          open: async (target) => {
            opened.push(target);
          },
        },
      });

      expect(opened).toEqual([
        "https://dash.freestyle.sh/handler/cli-auth-confirm?login_code=login-code",
      ]);
      expect(requests.some((request) => request.authorization === "Bearer stale-api-key")).toBe(false);
      expect(hostStorage.entries("identity:")[0]?.value).toMatchObject({
        identityId: "identity-browser",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

class MemoryProviderStorage implements ProviderStorage {
  private readonly records = new Map<string, ProviderStorageRecord>();

  constructor(private readonly providerId: string) {}

  get<Value extends JsonValue = JsonValue>(key: string): ProviderStorageRecord<Value> | undefined {
    return this.records.get(key) as ProviderStorageRecord<Value> | undefined;
  }

  set<Value extends JsonValue = JsonValue>(key: string, value: Value): ProviderStorageRecord<Value> {
    const now = new Date().toISOString();
    const existing = this.records.get(key);
    const record: ProviderStorageRecord<Value> = {
      providerId: this.providerId,
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key, record as ProviderStorageRecord);
    return record;
  }

  delete(key: string): void {
    this.records.delete(key);
  }

  entries(prefix = ""): ProviderStorageRecord[] {
    return [...this.records.values()]
      .filter((record) => record.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}

function providerContext(
  events: WorkflowEvent[],
  local: Partial<ProviderRuntimeContext["local"]> = {},
): ProviderRuntimeContext {
  return {
    workflow: "workflow",
    nodePath: "workflow.step",
    emit: (event) => {
      events.push(event);
    },
    interaction: {
      present: async () => {
        throw new Error("unexpected interaction");
      },
    },
    local: {
      open: async () => {},
      ...local,
    },
    metadata: () => {},
  };
}

function testFetch(
  handler: (
    resource: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => Response | Promise<Response>,
): typeof fetch {
  const fetchFn = (async (resource, init) => await handler(resource, init)) as typeof fetch;
  fetchFn.preconnect = () => {};
  return fetchFn;
}

function resourceUrl(resource: Parameters<typeof fetch>[0]): URL {
  if (typeof resource === "string") return new URL(resource);
  if (resource instanceof URL) return resource;
  return new URL(resource.url);
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
