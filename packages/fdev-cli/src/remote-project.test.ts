import { describe, expect, test } from "bun:test";
import {
  parseGithubProjectTarget,
  remoteProjectId,
  splitGithubProjectTarget,
} from "./remote-project.ts";

describe("remote GitHub project targets", () => {
  test("parses github owner repo targets with optional refs", () => {
    expect(parseGithubProjectTarget("github:freestyle-sh/fdev")).toEqual({
      kind: "github",
      raw: "github:freestyle-sh/fdev",
      owner: "freestyle-sh",
      repo: "fdev",
    });

    expect(parseGithubProjectTarget("github:freestyle-sh/fdev#feature/runtime")).toEqual({
      kind: "github",
      raw: "github:freestyle-sh/fdev#feature/runtime",
      owner: "freestyle-sh",
      repo: "fdev",
      ref: "feature/runtime",
    });
  });

  test("splits a run target from operation arguments", () => {
    const split = splitGithubProjectTarget(["github:freestyle-sh/fdev@main", "--workflow", "smoke"]);

    expect(split.target).toEqual({
      kind: "github",
      raw: "github:freestyle-sh/fdev@main",
      owner: "freestyle-sh",
      repo: "fdev",
      ref: "main",
    });
    expect(split.args).toEqual(["--workflow", "smoke"]);
  });

  test("remote project ids include repo, ref, commit, and config path", () => {
    const id = remoteProjectId({
      repoUrl: "https://github.com/freestyle-sh/fdev.git",
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      configPath: "fdev.config.ts",
    });

    expect(id).toMatch(/^github-[a-f0-9]{32}$/);
    expect(remoteProjectId({
      repoUrl: "https://github.com/freestyle-sh/fdev.git",
      ref: "main",
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      configPath: "fdev.config.ts",
    })).not.toBe(id);
  });
});
