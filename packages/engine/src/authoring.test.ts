import { describe, expect, test } from "bun:test";
import { defineProvider, workflow } from "./authoring.ts";

describe("provider authoring scopes", () => {
  test("removeProvider only affects executable units defined after it", () => {
    const remote = defineProvider("remote", {}, {
      providerId: "remote",
      capabilities: [{ id: "ssh", schemaHash: "sha256:ssh-v1" }],
      createProvider() {
        return { providerId: "remote", runtime: () => ({}) };
      },
    });

    const definition = workflow("scopes")
      .sequence("scopes")
      .addProvider("remote", remote)
      .operation("before-remove", { run: async () => ({ ok: true }) })
      .removeProvider("remote")
      .operation("after-remove", { run: async () => ({ ok: true }) });

    expect(Object.keys(definition.operations?.[0]?.providerScope ?? {})).toEqual(["remote"]);
    expect(Object.keys(definition.operations?.[1]?.providerScope ?? {})).toEqual([]);
    expect(Object.keys(definition.providerScope ?? {})).toEqual([]);
  });

  test("rejects removing a provider outside the current scope", () => {
    expect(() => (workflow("scopes").sequence("scopes") as any).removeProvider("missing"))
      .toThrow("Provider missing is not configured in this scope");
  });
});
