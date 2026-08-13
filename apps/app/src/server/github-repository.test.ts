import { describe, expect, test } from "bun:test";
import {
  GitHubRateLimitError,
  PublicGitHubRepositoryRequiredError,
  githubSourceFromRemote,
  requirePublicGitHubRepository,
  resolvePublicGitHubRevision,
} from "./github-repository.ts";

const source = { kind: "github" as const, owner: "vercel", repository: "next.js" };
const revision = "e587a05a934ac7be12bf5233102939d4479f8625";

describe("public GitHub repository resolution", () => {
  test("resolves common GitHub origin formats", () => {
    expect(githubSourceFromRemote("git@github.com:vercel/next.js.git")).toMatchObject({
      kind: "github",
      owner: "vercel",
      repository: "next.js",
    });
    expect(githubSourceFromRemote("ssh://git@github.com/vercel/next.js.git")).toMatchObject({
      owner: "vercel",
      repository: "next.js",
    });
    expect(githubSourceFromRemote("https://gitlab.com/vercel/next.js")).toBeUndefined();
  });

  test("verifies public visibility and pins the default branch commit", async () => {
    const requests: Request[] = [];
    const previousClientId = process.env.GITHUB_CLIENT_ID;
    const previousClientSecret = process.env.GITHUB_CLIENT_SECRET;
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret";
    try {
      const resolved = await resolvePublicGitHubRevision(source, async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return request.url.endsWith("/commits/canary")
          ? Response.json({ sha: revision })
          : Response.json({ private: false, default_branch: "canary" });
      });

      expect(resolved).toBe(revision);
    } finally {
      restoreEnvironment("GITHUB_CLIENT_ID", previousClientId);
      restoreEnvironment("GITHUB_CLIENT_SECRET", previousClientSecret);
    }
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
  });

  test("rejects private or inaccessible repositories", async () => {
    expect(requirePublicGitHubRepository(source, async () =>
      Response.json({ message: "Not Found" }, { status: 404 })
    )).rejects.toEqual(new PublicGitHubRepositoryRequiredError(
      "Only public GitHub repositories can be added to Stoke. vercel/next.js is private or unavailable.",
    ));
  });

  test("preserves GitHub rate-limit reset information", async () => {
    const retryAt = "2026-08-13T21:00:00.000Z";
    const reset = String(new Date(retryAt).getTime() / 1_000);

    await expect(requirePublicGitHubRepository(source, async () =>
      Response.json(
        { message: "API rate limit exceeded" },
        { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } },
      )
    )).rejects.toEqual(new GitHubRateLimitError(
      "GitHub temporarily rate limited Stoke while trying to verify vercel/next.js",
      retryAt,
    ));
  });
});

function restoreEnvironment(key: "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
