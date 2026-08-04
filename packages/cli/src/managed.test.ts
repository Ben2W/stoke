import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitHubRepository, resolveProjectSource } from "./managed.ts";

describe("managed project source resolution", () => {
  test("accepts common GitHub repository forms", () => {
    expect(parseGitHubRepository("vercel/next.js")).toEqual({
      owner: "vercel",
      repository: "next.js",
    });
    expect(parseGitHubRepository("https://github.com/freestyle-sh/rigkit.git")).toEqual({
      owner: "freestyle-sh",
      repository: "rigkit",
    });
    expect(parseGitHubRepository("git@github.com:freestyle-sh/rigkit.git")).toEqual({
      owner: "freestyle-sh",
      repository: "rigkit",
    });
  });

  test("scopes local directories to a named machine", () => {
    const root = mkdtempSync(join(tmpdir(), "stoke-source-"));
    const projectDir = join(root, "website");
    mkdirSync(projectDir);
    try {
      expect(resolveProjectSource("./website", {
        cwd: root,
        environment: {
          STOKE_MACHINE_ID: "benjamins-macbook",
          STOKE_MACHINE_NAME: "Benjamin's MacBook",
        },
      })).toEqual({
        name: "website",
        source: {
          kind: "local",
          machineId: "benjamins-macbook",
          machineName: "Benjamin's MacBook",
          path: realpathSync(projectDir),
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds and lists managed projects through the CLI", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    const requests: Array<{ method: string; authorization: string | null; body?: unknown }> = [];
    const project = {
      id: "73d1f165-c7e2-4ef9-a799-bd99a81a7c2b",
      slug: "vercel-next-js",
      name: "next.js",
      source: {
        kind: "github" as const,
        owner: "vercel",
        repository: "next.js",
        url: "https://github.com/vercel/next.js",
      },
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({
          method: request.method,
          authorization: request.headers.get("authorization"),
          body,
        });
        return Response.json(request.method === "POST" ? { project } : { projects: [project] });
      },
    });

    try {
      const environment = {
        STOKE_API_URL: `http://127.0.0.1:${server.port}`,
        STOKE_TOKEN: "test-secret",
      };
      const added = await runManagedCli(["add", "vercel/next.js", "--json"], cwd, environment);
      const listed = await runManagedCli(["ls", "--json"], cwd, environment);

      expect(added.exitCode).toBe(0);
      expect(JSON.parse(added.stdout)).toEqual({ project });
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual({ projects: [project] });
      expect(requests).toEqual([
        {
          method: "POST",
          authorization: "Bearer test-secret",
          body: {
            name: "next.js",
            source: {
              kind: "github",
              owner: "vercel",
              repository: "next.js",
              url: "https://github.com/vercel/next.js",
            },
          },
        },
        { method: "GET", authorization: "Bearer test-secret", body: undefined },
      ]);
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

async function runManagedCli(
  args: string[],
  cwd: string,
  environment: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const processHandle = Bun.spawn(["bun", join(import.meta.dir, "cli.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...environment,
      RIGKIT_UPDATE_CHECK: "0",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
