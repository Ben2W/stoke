import { describe, expect, test } from "bun:test";
import { parseGitHubProjectUrl } from "./api-client.ts";

describe("dashboard API client", () => {
  test("parses a GitHub repository URL for the add-project dialog", () => {
    expect(parseGitHubProjectUrl("https://github.com/Vercel/next.js.git")).toEqual({
      kind: "github",
      owner: "Vercel",
      repository: "next.js",
      url: "https://github.com/Vercel/next.js",
    });
  });

  test("rejects non-repository and non-GitHub URLs", () => {
    expect(() => parseGitHubProjectUrl("https://gitlab.com/vercel/next.js")).toThrow("github.com");
    expect(() => parseGitHubProjectUrl("https://github.com/vercel")).toThrow("repository URL");
  });
});
