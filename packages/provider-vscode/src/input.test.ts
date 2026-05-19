import { describe, expect, test } from "bun:test";
import type { RuntimeControlOperation, RuntimeControlWorkspace } from "@rigkit/runtime-client";
import { collectOperationInput } from "./input.ts";

describe("VS Code operation input collection", () => {
  test("collects workspace and scalar fields from runtime schema metadata", async () => {
    const workspace = workspaceRecord("demo");
    const operation: RuntimeControlOperation = {
      workflow: "test",
      id: "fork",
      kind: "workspace-action",
      source: "config",
      title: "Fork",
      description: "",
      cli: {
        positionals: [
          { name: "from", index: 0 },
          { name: "name", index: 1 },
        ],
      },
      inputSchema: {
        type: "object",
        required: ["from", "name"],
        properties: {
          from: {
            type: "string",
            description: "Workspace to fork",
            "x-rigkit-input": { kind: "workspace" },
          },
          name: {
            type: "string",
            description: "New workspace name",
          },
        },
      },
    };

    const input = await collectOperationInput(operation, [workspace], {
      inputText: async () => "copy",
      confirm: async () => false,
      select: async () => undefined,
      pickWorkspace: async () => workspace,
    });

    expect(input).toEqual({ from: "demo", name: "copy" });
  });

  test("returns undefined when a required prompt is cancelled", async () => {
    const operation: RuntimeControlOperation = {
      workflow: "test",
      id: "create",
      kind: "command",
      source: "core",
      title: "Create",
      description: "",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
        },
      },
    };

    await expect(collectOperationInput(operation, [], {
      inputText: async () => undefined,
      confirm: async () => undefined,
      select: async () => undefined,
      pickWorkspace: async () => undefined,
    })).resolves.toBeUndefined();
  });

  test("collects enum values with a select prompt", async () => {
    const operation: RuntimeControlOperation = {
      workflow: "test",
      id: "dev",
      kind: "workspace-action",
      source: "config",
      title: "Dev",
      description: "",
      inputSchema: {
        type: "object",
        required: ["mode"],
        properties: {
          mode: {
            type: "string",
            enum: ["local", "tunnel"],
            description: "Dev mode",
          },
        },
      },
    };

    const input = await collectOperationInput(operation, [], {
      inputText: async () => undefined,
      confirm: async () => undefined,
      select: async ({ options }) => options[1]?.value,
      pickWorkspace: async () => undefined,
    });

    expect(input).toEqual({ mode: "tunnel" });
  });
});

function workspaceRecord(name: string): RuntimeControlWorkspace {
  return {
    id: `ws-${name}`,
    name,
    workflow: "test",
    ctx: {},
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
  };
}
