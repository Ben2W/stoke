import { afterEach, describe, expect, test } from "bun:test";
import type {
  JsonValue,
  ProviderCheckContext,
  ProviderRuntimeContext,
  ProviderStorage,
  ProviderStorageRecord,
  WorkflowProviderCheckResult,
  WorkflowProviderController,
  WorkflowEvent,
} from "@rigkit/engine";
import { FREESTYLE_PROVIDER_ID, freestyle, freestyleProviderPlugin } from "./index.ts";
import { createFreestyleProxyFetch, createFreestyleSdkFetch } from "./host-auth.ts";
import type { FreestyleRuntime } from "./provider.ts";
import { RIGKIT_PROVIDER_FREESTYLE_VERSION } from "./version.ts";

const originalFreestyleApiKey = process.env.FREESTYLE_API_KEY;
const originalFreestyleTeamId = process.env.FREESTYLE_TEAM_ID;

afterEach(() => {
  setEnv("FREESTYLE_API_KEY", originalFreestyleApiKey);
  setEnv("FREESTYLE_TEAM_ID", originalFreestyleTeamId);
});

describe("Freestyle provider host auth", () => {
  test("accepts an API key as the provider shorthand", () => {
    expect(freestyle.provider("shorthand-api-key").config).toEqual({
      apiKey: "shorthand-api-key",
    });
  });

  test("rejects the old nested auth config shape", async () => {
    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);

    await expect(freestyleProviderPlugin.createProvider({
      provider: {
        providerId: FREESTYLE_PROVIDER_ID,
        config: {
          auth: { apiKey: "nested-api-key" },
        },
      },
      storage: projectStorage,
      hostStorage,
      local: { open: async () => {} },
    })).rejects.toThrow("Invalid Freestyle provider config");
  });

  test("uses explicit API-key auth and stores identity tokens in host storage", async () => {
    process.env.FREESTYLE_API_KEY = "ignored-env-api-key";
    delete process.env.FREESTYLE_TEAM_ID;

    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      rigkit: string | null;
      rigkitVersion: string | null;
    }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = testFetch((resource, init) => {
      const url = resourceUrl(resource);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({
        url: url.href,
        method,
        authorization: headers.get("authorization"),
        rigkit: headers.get("x-rigkit"),
        rigkitVersion: headers.get("x-rigkit-version"),
      });
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
            apiKey: "object-api-key",
          },
        },
        storage: projectStorage,
        hostStorage,
        local: { open: async () => {} },
      });

      expect(projectStorage.entries()).toEqual([]);
      expect(hostStorage.entries("identity:")).toHaveLength(0);
      expect(requests).toHaveLength(0);

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
          rigkit: "true",
          rigkitVersion: RIGKIT_PROVIDER_FREESTYLE_VERSION,
        },
        {
          url: "https://api.freestyle.sh/identity/v1/identities/identity-api-key/tokens",
          method: "POST",
          authorization: "Bearer object-api-key",
          rigkit: "true",
          rigkitVersion: RIGKIT_PROVIDER_FREESTYLE_VERSION,
        },
      ]);

      const nextController = await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: {
            apiKey: "object-api-key",
          },
        },
        storage: projectStorage,
        hostStorage,
        local: { open: async () => {} },
      });
      const requireChecks = providerCheckList(await nextController.checks?.(providerCheckContext("require")));
      const planChecks = providerCheckList(await nextController.checks?.(providerCheckContext("plan")));
      expect(planChecks[0]).toMatchObject({
        id: "auth",
        status: "ok",
        fingerprint: "identity:identity-api-key",
      });
      expect(planChecks[0]?.fingerprint).toBe(requireChecks[0]?.fingerprint);
      expect(requests).toHaveLength(2);
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
            teamId: "team_123",
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

      await controller.checks?.(providerCheckContext("require"));

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
            headers: expect.objectContaining({
              "x-rigkit": "true",
              "x-rigkit-version": RIGKIT_PROVIDER_FREESTYLE_VERSION,
            }),
          },
        },
        {
          data: {
            accessToken: "stack-access-token",
            teamId: "team_123",
            path: "identity/v1/identities/identity-browser/tokens",
            method: "POST",
            headers: expect.objectContaining({
              "x-rigkit": "true",
              "x-rigkit-version": RIGKIT_PROVIDER_FREESTYLE_VERSION,
            }),
          },
        },
      ]);

      const nextController = await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: {
            teamId: "team_123",
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
      const requireChecks = providerCheckList(await nextController.checks?.(providerCheckContext("require")));
      const planChecks = providerCheckList(await nextController.checks?.(providerCheckContext("plan")));
      expect(planChecks[0]).toMatchObject({
        id: "team",
        status: "ok",
        fingerprint: "identity:identity-browser",
      });
      expect(planChecks[0]?.fingerprint).toBe(requireChecks[0]?.fingerprint);
      expect(proxyRequests).toHaveLength(2);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("reports a required browser auth check during plan without starting OAuth", async () => {
    delete process.env.FREESTYLE_API_KEY;
    delete process.env.FREESTYLE_TEAM_ID;

    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = testFetch(async () =>
      Response.json({ error: "plan should not fetch" }, { status: 500 })
    );

    try {
      const controller = await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: {},
        },
        storage: projectStorage,
        hostStorage,
        local: { open: async () => {} },
      });

      expect(await controller.checks?.(providerCheckContext("plan"))).toEqual([{
        id: "auth",
        label: "Freestyle auth",
        status: "required",
        value: "login required",
        message: "Run rig apply, rig create, or rig run to authenticate with Freestyle.",
        fingerprint: "browser:default:auth:missing",
      }]);
      expect(hostStorage.entries()).toEqual([]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("prompts for and persists a Freestyle team when browser auth has multiple teams", async () => {
    delete process.env.FREESTYLE_API_KEY;
    delete process.env.FREESTYLE_TEAM_ID;

    const projectStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const hostStorage = new MemoryProviderStorage(FREESTYLE_PROVIDER_ID);
    const selectPrompts: unknown[] = [];
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
        return Response.json({ access_token: "stack-access-token", refresh_token: "refresh-token" });
      }
      if (url.href === "https://dash.freestyle.sh/api/cli/teams") {
        return Response.json([
          { id: "team_alpha", displayName: "Alpha" },
          { id: "team_beta", displayName: "Beta", sandboxAccountId: "sandbox-beta" },
        ]);
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
          config: {},
        },
        storage: projectStorage,
        hostStorage,
        local: {
          open: async () => {},
          prompt: {
            message: async () => {},
            text: async () => "",
            confirm: async () => true,
            select: async (prompt) => {
              selectPrompts.push(prompt);
              return "team_beta";
            },
          },
        },
      });
      const checks = await controller.checks?.(providerCheckContext("require"));

      expect(selectPrompts).toEqual([{
        message: "Choose Freestyle team",
        options: [
          { value: "team_alpha", label: "Alpha (team_alpha)", description: undefined },
          { value: "team_beta", label: "Beta (team_beta)", description: "sandbox sandbox-beta" },
        ],
      }]);
      expect(hostStorage.entries("stack-auth:")[0]?.value).toMatchObject({
        refreshToken: "refresh-token",
        accessToken: "stack-access-token",
        defaultTeamId: "team_beta",
        defaultTeamName: "Beta",
      });
      expect(proxyRequests).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            teamId: "team_beta",
            path: "identity/v1/identities",
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            teamId: "team_beta",
            path: "identity/v1/identities/identity-browser/tokens",
          }),
        }),
      ]);
      expect(checks).toContainEqual(expect.objectContaining({
        id: "team",
        label: "Freestyle team",
        status: "ok",
        value: "Beta (team_beta)",
        detail: "team_beta",
        metadata: {
          teamId: "team_beta",
          teamName: "Beta",
        },
      }));
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
      const controller = await freestyleProviderPlugin.createProvider({
        provider: {
          providerId: FREESTYLE_PROVIDER_ID,
          config: {},
        },
        storage: projectStorage,
        hostStorage,
        local: {
          open: async (target) => {
            opened.push(target);
          },
        },
      });
      await controller.checks?.(providerCheckContext("require"));

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

describe("Freestyle provider proxy fetch", () => {
  test("logs a replayable API-key fetch with the Freestyle API key redacted", async () => {
    const sdkFetch = createFreestyleSdkFetch(testFetch(async () =>
      Response.json({
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }, {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "x-freestyle-trace-id": "trace_sdk_123" },
      })
    ));

    const messages = await captureConsoleError(async () => {
      const response = await sdkFetch("https://api.freestyle.sh/v1/vms", {
        method: "POST",
        headers: {
          Authorization: "Bearer real-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: "ubuntu-24.04",
          apiKey: "body-api-key",
        }),
      });
      expect(response.status).toBe(500);
      await response.text();
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('await fetch("https://api.freestyle.sh/v1/vms", {');
    expect(messages[0]).toContain('"Authorization": "Bearer <redacted FREESTYLE_API_KEY>"');
    expect(messages[0]).toContain('"image": "ubuntu-24.04"');
    expect(messages[0]).toContain('"apiKey": "[redacted]"');
    expect(messages[0]).toContain('Response: 500 Internal Server Error');
    expect(messages[0]).toContain("TraceId: trace_sdk_123");
    expect(messages[0]).not.toContain("real-api-key");
    expect(messages[0]).not.toContain("body-api-key");
  });

  test("logs the original replayable request when a background request fails through the proxy", async () => {
    const proxyFetch = createFreestyleProxyFetch({
      dashboardUrl: "https://dash.freestyle.sh",
      accessToken: "stack-access-token",
      teamId: "team_123",
      fetch: testFetch(async (resource, init) => {
        const url = resourceUrl(resource);
        expect(url.href).toBe("https://dash.freestyle.sh/api/proxy/request");
        const body = JSON.parse(String(init?.body));
        if (body.data.path === "v1/vms") {
          return Response.json({
            requestId: "ri_test_123",
            status: "pending",
          });
        }
        if (body.data.path === "auth/v1/background-requests/ri_test_123") {
          return Response.json({
            code: "INTERNAL_ERROR",
            message: "Internal server error",
            accessToken: "should-redact",
          }, { status: 500, statusText: "Internal Server Error" });
        }
        return Response.json({ error: "unexpected request", body }, { status: 500 });
      }),
    });

    const first = await proxyFetch("https://api.freestyle.sh/v1/vms", {
      method: "POST",
      headers: {
        Authorization: "Bearer rigkit-browser-auth",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: "ubuntu-24.04",
      }),
    });
    expect(first.status).toBe(202);

    const messages = await captureConsoleError(async () => {
      const failed = await proxyFetch("https://api.freestyle.sh/auth/v1/background-requests/ri_test_123", {
        method: "GET",
        headers: {
          Authorization: "Bearer rigkit-browser-auth",
        },
      });
      expect(failed.status).toBe(500);
      await failed.text();
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Freestyle background request ri_test_123 failed. Original API request:");
    expect(messages[0]).toContain('await fetch("https://api.freestyle.sh/v1/vms", {');
    expect(messages[0]).toContain('method: "POST"');
    expect(messages[0]).toContain('"Authorization": "Bearer <redacted FREESTYLE_API_KEY>"');
    expect(messages[0]).toContain('"image": "ubuntu-24.04"');
    expect(messages[0]).toContain('Response: 500 Internal Server Error');
    expect(messages[0]).toContain('"accessToken":"[redacted]"');
    expect(messages[0]).not.toContain("stack-access-token");
    expect(messages[0]).not.toContain("rigkit-browser-auth");
    expect(messages[0]).not.toContain("should-redact");
  });

  test("preserves Freestyle background request semantics through the browser-auth proxy", async () => {
    const proxyFetch = createFreestyleProxyFetch({
      dashboardUrl: "https://dash.freestyle.sh",
      accessToken: "stack-access-token",
      teamId: "team_123",
      fetch: testFetch(async (resource, init) => {
        const url = resourceUrl(resource);
        expect(url.href).toBe("https://dash.freestyle.sh/api/proxy/request");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("x-rigkit")).toBe("true");
        expect(new Headers(init?.headers).get("x-rigkit-version")).toBe(RIGKIT_PROVIDER_FREESTYLE_VERSION);

        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          data: {
            accessToken: "stack-access-token",
            teamId: "team_123",
            path: "v1/vms",
            method: "POST",
            headers: {
              "x-rigkit": "true",
              "x-rigkit-version": RIGKIT_PROVIDER_FREESTYLE_VERSION,
            },
          },
        });

        return Response.json({
          requestId: "ri_test_123",
          status: "pending",
          resultUrl: "/auth/v1/background-requests/ri_test_123",
          logsUrl: "/observability/v1/logs?requestId=ri_test_123",
        });
      }),
    });

    const response = await proxyFetch("https://api.freestyle.sh/v1/vms", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("x-freestyle-background-request-id")).toBe("ri_test_123");
    await expect(response.json()).resolves.toMatchObject({
      requestId: "ri_test_123",
      status: "pending",
    });
  });

  test("preserves proxy error details for run logs", async () => {
    const proxyFetch = createFreestyleProxyFetch({
      dashboardUrl: "https://dash.freestyle.sh",
      accessToken: "stack-access-token",
      teamId: "team_123",
      fetch: testFetch(async () =>
        Response.json({
          error: "VM setup failed",
          requestId: "req_123",
          logs: ["failed to boot base image"],
          accessToken: "secret-token",
        }, { status: 500, headers: { "x-freestyle-trace-id": "trace_proxy_123" } })
      ),
    });

    let response: Response | undefined;
    const messages = await captureConsoleError(async () => {
      response = await proxyFetch("https://api.freestyle.sh/v1/vms", {
        method: "POST",
        body: "{}",
      });
    });

    expect(response?.status).toBe(500);
    expect(response?.headers.get("x-freestyle-trace-id")).toBe("trace_proxy_123");
    expect(messages[0]).toContain("TraceId: trace_proxy_123");
    await expect(response?.json()).resolves.toEqual({
      code: "INTERNAL_ERROR",
      message: "VM setup failed",
      details: {
        error: "VM setup failed",
        requestId: "req_123",
        logs: ["failed to boot base image"],
        accessToken: "[redacted]",
      },
    });
  });

  test("redacts sensitive fields on coded proxy errors", async () => {
    const proxyFetch = createFreestyleProxyFetch({
      dashboardUrl: "https://dash.freestyle.sh",
      accessToken: "stack-access-token",
      teamId: "team_123",
      fetch: testFetch(async () =>
        Response.json({
          code: "INTERNAL_ERROR",
          message: "Internal server error",
          requestId: "req_123",
          accessToken: "secret-token",
        }, { status: 500 })
      ),
    });

    let response: Response | undefined;
    await captureConsoleError(async () => {
      response = await proxyFetch("https://api.freestyle.sh/v1/vms");
    });

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId: "req_123",
      accessToken: "[redacted]",
    });
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

function providerCheckContext(mode: "plan" | "require"): ProviderCheckContext {
  return {
    mode,
    workflow: "workflow",
    local: providerContext([]).local,
  };
}

function providerCheckList(
  result: WorkflowProviderCheckResult | WorkflowProviderCheckResult[] | undefined,
): WorkflowProviderCheckResult[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
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

async function captureConsoleError(action: () => Promise<void>): Promise<string[]> {
  const previous = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await action();
  } finally {
    console.error = previous;
  }
  return messages;
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
