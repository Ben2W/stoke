import { describe, expect, test } from "bun:test";
import { createVscodeOpenHostCapability } from "./host.ts";
import { vscode, vscodeProviderPlugin } from "./index.ts";

describe("VS Code provider", () => {
  test("declares vscode.open", () => {
    expect(vscode.provider().plugin).toBe(vscodeProviderPlugin);
    expect(vscodeProviderPlugin.capabilities?.map((capability) => capability.id)).toEqual(["vscode.open"]);
  });

  test("passes a validated SSH authority to the local host", async () => {
    const opened: Array<[string, string | undefined]> = [];
    const host = createVscodeOpenHostCapability({ open: (authority, path) => { opened.push([authority, path]); } });
    expect(await host.handle({ authority: "dev@example.com", path: "/workspace" })).toEqual({ opened: true });
    expect(opened).toEqual([["dev@example.com", "/workspace"]]);
    await expect(host.handle({ authority: "bad authority" })).rejects.toThrow();
  });
});
