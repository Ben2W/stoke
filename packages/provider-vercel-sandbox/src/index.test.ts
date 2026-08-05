import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SSH_CAPABILITY,
  parseVercelSandboxSshInput,
  vercelSandbox,
  vercelSandboxTerminalProviderPlugin,
  readStokeAccessToken,
  type VercelSandboxTerminalRuntime,
} from "./index.ts";
import { createVercelSandboxSshHostCapability } from "./host.ts";

const originalToken = process.env.STOKE_TOKEN;
const originalTokenFile = process.env.STOKE_TOKEN_FILE;

afterEach(() => {
  restoreEnvironment("STOKE_TOKEN", originalToken);
  restoreEnvironment("STOKE_TOKEN_FILE", originalTokenFile);
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
