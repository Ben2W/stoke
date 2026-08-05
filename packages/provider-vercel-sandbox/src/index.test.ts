import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SSH_CAPABILITY,
  createVercelSandboxRuntime,
  parseVercelSandboxSshInput,
  vercelSandbox,
  vercelSandboxTerminalProviderPlugin,
  readStokeAccessToken,
  type VercelSandboxTerminalRuntime,
} from "./index.ts";
import { createVercelSandboxSshHostCapability } from "./host.ts";

const originalToken = process.env.STOKE_TOKEN;
const originalTokenFile = process.env.STOKE_TOKEN_FILE;
const originalProjectId = process.env.STOKE_PROJECT_ID;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnvironment("STOKE_TOKEN", originalToken);
  restoreEnvironment("STOKE_TOKEN_FILE", originalTokenFile);
  restoreEnvironment("STOKE_PROJECT_ID", originalProjectId);
  globalThis.fetch = originalFetch;
});

describe("Vercel Sandbox provider", () => {
  test("keeps SDK and terminal providers separate", () => {
    expect(vercelSandbox.provider().plugin).toBeDefined();
    expect(vercelSandbox.terminal().plugin).toBe(vercelSandboxTerminalProviderPlugin);
    expect(vercelSandboxTerminalProviderPlugin.capabilities).toEqual([SSH_CAPABILITY]);
  });

  test("does not expose a direct Vercel credential mode", () => {
    expect(vercelSandbox.provider().config).toEqual({});
  });

  test("creates setup sandboxes, snapshots them, and restores workspaces", async () => {
    process.env.STOKE_PROJECT_ID = "f95df42b-48da-4a02-926b-60def0ee77cf";
    process.env.STOKE_TOKEN = "sandbox-ticket";
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/snapshots")) {
        return Response.json({ snapshot: { snapshotId: "snap_prepared" } }, { status: 201 });
      }
      return Response.json({ sandbox: { name: "quiet-otter", domains: {} } }, { status: 201 });
    }) as typeof fetch;

    const runtime = createVercelSandboxRuntime({ baseUrl: "https://usestoke.dev" });
    const setup = await runtime.client.create();
    await expect(setup.snapshot({ expiration: 0 })).resolves.toEqual({ snapshotId: "snap_prepared" });
    await runtime.client.create({ snapshotId: "snap_prepared", ports: [3000] });

    expect(await Promise.all(requests.map(async (request) => ({
      path: new URL(request.url).pathname,
      body: await request.json(),
    })))).toEqual([
      {
        path: "/api/v1/sandboxes",
        body: {
          projectId: process.env.STOKE_PROJECT_ID,
          source: { type: "empty" },
          runtime: "node24",
          ports: [],
        },
      },
      {
        path: "/api/v1/sandboxes/quiet-otter/snapshots",
        body: {
          projectId: process.env.STOKE_PROJECT_ID,
          expiration: 0,
        },
      },
      {
        path: "/api/v1/sandboxes",
        body: {
          projectId: process.env.STOKE_PROJECT_ID,
          source: { type: "snapshot", snapshotId: "snap_prepared" },
          runtime: "node24",
          ports: [3000],
        },
      },
    ]);
  });

  test("reads a refreshed sandbox token file before the inherited environment", () => {
    const directory = mkdtempSync(join(tmpdir(), "stoke-token-"));
    const tokenFile = join(directory, "token");
    try {
      process.env.STOKE_TOKEN = "expired-token";
      process.env.STOKE_TOKEN_FILE = tokenFile;
      writeFileSync(tokenFile, "fresh-token\n");
      expect(readStokeAccessToken()).toBe("fresh-token");
      writeFileSync(tokenFile, "newer-token\n");
      expect(readStokeAccessToken()).toBe("newer-token");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("parses only Vercel Sandbox ssh requests", () => {
    expect(parseVercelSandboxSshInput({
      provider: "vercel-sandbox",
      sandbox: " demo ",
    })).toEqual({ provider: "vercel-sandbox", sandbox: "demo" });
    expect(() => parseVercelSandboxSshInput({ provider: "other", sandbox: "demo" }))
      .toThrow('provider must be "vercel-sandbox"');
  });

  test("runs the provider-owned host implementation locally", async () => {
    const requested: string[] = [];
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const handler = createVercelSandboxSshHostCapability({
      open(sandbox) {
        requested.push(sandbox);
        return closed;
      },
    });

    const result = await handler.handle({
      provider: "vercel-sandbox",
      sandbox: "demo",
    }) as { attached: true; closed: Promise<void> };
    expect(result.attached).toBe(true);
    expect(requested).toEqual(["demo"]);
    close();
    await expect(result.closed).resolves.toBeUndefined();
  });

  test("keeps an ssh operation attached until its host session closes", async () => {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const requests: unknown[] = [];
    const requestCapabilitySession = async <Result,>(
      capability: string,
      params: unknown,
      options: unknown,
    ) => {
      requests.push({ capability, params, options });
      return { result: { attached: true } as Result, closed };
    };
    const controller = await vercelSandboxTerminalProviderPlugin.createProvider({
      provider: vercelSandbox.terminal() as any,
      storage: {} as any,
      hostStorage: {} as any,
      local: {
        open: () => {},
        requestCapabilitySession,
      },
    });
    const runtime = await controller.runtime({
      workflow: "example",
      nodePath: "ssh",
      emit: () => {},
      interaction: { present: async () => undefined as never },
      local: {
        open: () => {},
        requestCapabilitySession,
      },
      metadata: () => {},
    }) as VercelSandboxTerminalRuntime;

    let finished = false;
    const opening = runtime.open({ sandbox: "demo", title: "SSH demo" })
      .then((result) => {
        finished = true;
        return result;
      });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(requests).toEqual([{
      capability: "ssh",
      params: { provider: "vercel-sandbox", sandbox: "demo", title: "SSH demo" },
      options: { nodePath: "ssh" },
    }]);
    close();
    await expect(opening).resolves.toEqual({ finished: true });
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
