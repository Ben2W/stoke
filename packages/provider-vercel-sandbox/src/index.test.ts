import { describe, expect, test } from "bun:test";
import {
  SSH_CAPABILITY,
  parseVercelSandboxSshInput,
  vercelSandbox,
  vercelSandboxTerminalProviderPlugin,
  type VercelSandboxTerminalRuntime,
} from "./index.ts";
import { createVercelSandboxSshHostCapability } from "./host.ts";

describe("Vercel Sandbox provider", () => {
  test("keeps SDK and terminal providers separate", () => {
    expect(vercelSandbox.provider().plugin).toBeDefined();
    expect(vercelSandbox.terminal().plugin).toBe(vercelSandboxTerminalProviderPlugin);
    expect(vercelSandboxTerminalProviderPlugin.capabilities).toEqual([SSH_CAPABILITY]);
  });

  test("does not expose a direct Vercel credential mode", () => {
    expect(vercelSandbox.provider().config).toEqual({});
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
