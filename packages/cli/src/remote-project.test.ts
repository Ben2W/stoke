import { describe, expect, test } from "bun:test";
import {
  parseGithubProjectTarget,
  remoteProjectId,
  splitGithubProjectTarget,
} from "./remote-project.ts";

describe("remote GitHub project targets", () => {
  test("parses github owner repo targets with optional refs", () => {
    expect(parseGithubProjectTarget("github:freestyle-sh/rigkit")).toEqual({
      kind: "github",
      raw: "github:freestyle-sh/rigkit",
      owner: "freestyle-sh",
      repo: "rigkit",
    });

    expect(parseGithubProjectTarget("github:freestyle-sh/rigkit#feature/runtime")).toEqual({
      kind: "github",
      raw: "github:freestyle-sh/rigkit#feature/runtime",
      owner: "freestyle-sh",
      repo: "rigkit",
      ref: "feature/runtime",
    });
  });

  test("splits a run target from operation arguments", () => {
    const split = splitGithubProjectTarget(["github:freestyle-sh/rigkit@main", "--workflow", "smoke"]);

    expect(split.target).toEqual({
      kind: "github",
      raw: "github:freestyle-sh/rigkit@main",
      owner: "freestyle-sh",
      repo: "rigkit",
      ref: "main",
    });
    expect(split.args).toEqual(["--workflow", "smoke"]);
  });

  test("remote project ids include repo, ref, commit, and config path", () => {
    const id = remoteProjectId({
      repoUrl: "https://github.com/freestyle-sh/rigkit.git",
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      configPath: "rig.config.ts",
    });

    expect(id).toMatch(/^github-[a-f0-9]{32}$/);
    expect(remoteProjectId({
      repoUrl: "https://github.com/freestyle-sh/rigkit.git",
      ref: "main",
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      configPath: "rig.config.ts",
    })).not.toBe(id);
  });
});
