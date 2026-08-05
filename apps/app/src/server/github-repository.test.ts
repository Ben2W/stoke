import { describe, expect, test } from "bun:test";
import {
  PublicGitHubRepositoryRequiredError,
  requirePublicGitHubRepository,
  resolvePublicGitHubRevision,
} from "./github-repository.ts";

const source = { kind: "github" as const, owner: "vercel", repository: "next.js" };
const revision = "e587a05a934ac7be12bf5233102939d4479f8625";

describe("public GitHub repository resolution", () => {
  test("verifies public visibility and pins the default branch commit", async () => {
    const requests: Request[] = [];
    const resolved = await resolvePublicGitHubRevision(source, async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.url.endsWith("/commits/canary")
        ? Response.json({ sha: revision })
        : Response.json({ private: false, default_branch: "canary" });
    });

    expect(resolved).toBe(revision);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.has("authorization")).toBe(false);
  });

  test("rejects private or inaccessible repositories", async () => {
    expect(requirePublicGitHubRepository(source, async () =>
      Response.json({ message: "Not Found" }, { status: 404 })
    )).rejects.toEqual(new PublicGitHubRepositoryRequiredError(
      "Only public GitHub repositories can be added to Stoke. vercel/next.js is private or unavailable.",
    ));
  });
});
