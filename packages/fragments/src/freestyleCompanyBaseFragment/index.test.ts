import { describe, expect, test } from "bun:test";
import { workflow } from "@rigkit/sdk";
import {
  freestyleCompanyBaseFragment,
  withFreestyleCompanyBase,
  type FreestyleCompanyBaseFragmentContext,
} from "./index.ts";

describe("freestyleCompanyBaseFragment", () => {
  test("creates a global fragment with resolved tool config", () => {
    const fragment = freestyleCompanyBaseFragment({
      claude: false,
      vm: {
        home: "/home/runner",
        memSizeGb: 8,
      },
    });

    expect(fragment.name).toBe("freestyle-company-base");
    expect(fragment.cacheScope).toBe("global");
    expect(fragment.config).toMatchObject({
      github: true,
      codex: true,
      claude: false,
      bun: true,
      nodeMajor: 22,
      npmPackages: ["@openai/codex"],
      vm: {
        home: "/home/runner",
        idleTimeoutSeconds: 600,
        memSizeGb: 8,
        vcpuCount: 4,
        rootfsSizeGb: 24,
      },
    });
    expect(fragment.config?.systemPackages).toContain("git");
  });

  test("tool toggles control install and auth tasks together", () => {
    const fragment = freestyleCompanyBaseFragment({
      github: false,
      codex: false,
      claude: true,
    });

    expect(fragment.name).toBe("freestyle-company-base");
    expect(fragment.config).toMatchObject({
      github: false,
      codex: false,
      claude: true,
      npmPackages: ["@anthropic-ai/claude-code"],
    });
  });

  test("composes with a Freestyle workflow and a typed dependent sequence", () => {
    const app = workflow("example");

    const repoSetup = app
      .sequence<FreestyleCompanyBaseFragmentContext>("repo-setup")
      .task("repo-ready", async ({ step }) => ({
        ctx: {
          ...step.ctx,
          repoPath: "/workspace/app",
        },
      }));

    const root = app
      .sequence("root")
      .add(freestyleCompanyBaseFragment({ claude: false }))
      .add(repoSetup);

    expect(root.children.map((child) => child.name)).toEqual([
      "freestyle-company-base",
      "repo-setup",
    ]);
  });

  test("wraps a dependent sequence with the base fragment and auth check", () => {
    const app = workflow("wrapped-example");

    const repoSetup = app
      .sequence<FreestyleCompanyBaseFragmentContext>("repo-setup")
      .task("repo-ready", async ({ step }) => ({
        ctx: {
          ...step.ctx,
          repoPath: "/workspace/app",
        },
      }));

    const wrapped = withFreestyleCompanyBase(repoSetup, { claude: false });

    expect(wrapped.name).toBe("with-freestyle-company-base");
    expect(wrapped.nodeKind).toBe("sequence");
    expect((wrapped as any).children.map((child: { name: string }) => child.name)).toEqual([
      "freestyle-company-base",
      "repo-setup",
      "freestyle-company-base-auth-check",
    ]);
  });
});

if (false) {
  const app = workflow("wrapped-typecheck");

  const preservingSetup = app
    .sequence<FreestyleCompanyBaseFragmentContext>("preserving-setup")
    .task("preserve", async ({ step }) => ({
      ctx: {
        ...step.ctx,
        repoPath: "/workspace/app",
      },
    }));
  withFreestyleCompanyBase(preservingSetup);

  const droppingSetup = app
    .sequence<FreestyleCompanyBaseFragmentContext>("dropping-setup")
    .task("drop", async () => ({
      ctx: {
        repoPath: "/workspace/app",
      },
    }));

  // @ts-expect-error wrapped setup must preserve freestyleCompanyBase in ctx
  withFreestyleCompanyBase(droppingSetup);
}
