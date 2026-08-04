import { describe, expect, test } from "bun:test";
import { createManagedClient, ManagedApiError } from "./client.ts";

const project = {
  id: "fe055b36-1dbd-439a-9c11-21aab123ac74",
  slug: "freestyle-sh-rigkit",
  name: "Rigkit",
  source: { kind: "github" as const, owner: "freestyle-sh", repository: "rigkit" },
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

describe("managed client", () => {
  test("lists projects with bearer authentication", async () => {
    const requests: Request[] = [];
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev/",
      token: "secret",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ projects: [project] });
      },
    });

    expect(await client.listProjects()).toEqual([project]);
    expect(requests[0]?.url).toBe("https://usestoke.dev/api/v1/projects");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
  });

  test("surfaces structured API failures", async () => {
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev",
      token: "bad",
      fetch: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    });

    expect(client.listProjects()).rejects.toEqual(
      new ManagedApiError("Stoke API request failed with 401", 401, { error: "unauthorized" }),
    );
  });
});
