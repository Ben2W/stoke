import { describe, expect, test } from "bun:test";
import {
  defineProvider,
  isProviderDefinition,
  isWorkflow,
  isWorkflowNode,
  workflow,
} from "./authoring.ts";

type TestProviderRuntime = {
  readSecret(): string;
};

describe("fdev SDK workflow authoring", () => {
  test("creates structural workflow, provider, and node definitions", () => {
    const provider = defineProvider<"test", { token: string }, TestProviderRuntime>(
      "test",
      { token: "test-key" },
    );
    const app = workflow("test", {
      providers: { test: provider },
    });
    const node = app.sequence("setup").task("first", async () => {
      return { ready: true };
    });

    expect(app.kind).toBe("fdev.workflow");
    expect(provider.kind).toBe("fdev.provider");
    expect(node.kind).toBe("fdev.workflow-node");
    expect(node.nodeKind).toBe("sequence");
    expect(isWorkflow(app)).toBe(true);
    expect(isProviderDefinition(provider)).toBe(true);
    expect(isWorkflowNode(node)).toBe(true);
  });

  test("carries provider and context types through sequence tasks", () => {
    const provider = defineProvider<"test", { token: string }, TestProviderRuntime>(
      "test",
      { token: "test-key" },
    );
    const app = workflow("test", {
      providers: { test: provider },
    });

    const node = app
      .sequence("repo")
      .task("clone", async ({ test }) => {
        const secret: string = test.readSecret();
        expect(secret).toBeTypeOf("string");
        return { repoPath: "/workspace/repo" };
      })
      .task("install", async ({ ctx }) => {
        const repoPath: string = ctx.repoPath;
        expect(repoPath).toBe("/workspace/repo");
        return { installCommand: "bun install" };
      });

    expect(node.children).toHaveLength(2);
  });

  test("namespaces parallel branch output and preserves upstream context types", () => {
    const provider = defineProvider<"test", {}, TestProviderRuntime>("test", {});
    const app = workflow("parallel-test", {
      providers: { test: provider },
    });

    const base = app.sequence("base").task("create", async () => {
      return { token: "upstream" };
    });
    const left = app.sequence<{ token: string }>("left").task("left-task", async ({ ctx }) => {
      const token: string = ctx.token;
      return { leftValue: token };
    });
    const right = app.sequence<{ token: string }>("right").task("right-task", async ({ ctx }) => {
      const token: string = ctx.token;
      return { rightValue: token.length };
    });

    const root = app
      .sequence("root")
      .add(base)
      .parallel({ left, right })
      .task("join", async ({ ctx }) => {
        const leftValue: string = ctx.left.leftValue;
        const rightValue: number = ctx.right.rightValue;
        expect(leftValue).toBe("upstream");
        expect(rightValue).toBe(8);
      });

    expect(root.children).toHaveLength(3);
  });

  test("types workspace hooks with final context and providers", () => {
    const provider = defineProvider<"test", {}, TestProviderRuntime, { authority: string }>("test", {});
    const app = workflow("workspace-test", {
      providers: { test: provider },
    });

    const root = app
      .sequence("workspace")
      .task("setup", async () => {
        return { repoPath: "/workspace/repo" };
      })
      .workspace({
        source: (ctx) => ({ provider: "test", kind: "workspace", repoPath: ctx.repoPath }),
        onCreated: async ({ ctx, providers, providerContext }) => {
          const repoPath: string = ctx.repoPath;
          const secret: string = providers.test.readSecret();
          const authority: string = (providerContext as { authority: string }).authority;
          expect(repoPath).toBe("/workspace/repo");
          expect(secret).toBeTypeOf("string");
          expect(authority).toBeTypeOf("string");
        },
      });

    expect(root.workspaceDefinition?.onCreated).toBeTypeOf("function");
  });
});
