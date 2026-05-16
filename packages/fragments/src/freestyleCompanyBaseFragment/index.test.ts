import { describe, expect, test } from "bun:test";
import { freestyle } from "@rigkit/provider-freestyle";
import { workflow } from "@rigkit/sdk";
import { freestyleCompanyBaseFragment, type FreestyleCompanyBaseFragmentContext } from "./index.ts";

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
    const app = workflow("example", {
      providers: {
        freestyle: freestyle.provider(),
        terminal: freestyle.terminal(),
      },
    });

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
});
