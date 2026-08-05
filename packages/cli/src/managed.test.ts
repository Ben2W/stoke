import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureStokeDevice,
  parseGitHubRepository,
  readStokeSettings,
  resolveManagedProjectSelector,
  resolveProjectSource,
  setCurrentProject,
} from "./managed.ts";

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
        checkout: {
          path: realpathSync(projectDir),
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("persists a stable device and current project outside the checkout", () => {
    const stokeHome = mkdtempSync(join(tmpdir(), "stoke-home-"));
    const environment = { STOKE_HOME: stokeHome, STOKE_DEVICE_NAME: "Benjamin's MacBook" };
    try {
      const first = ensureStokeDevice(environment);
      const second = ensureStokeDevice(environment);
      expect(second).toEqual(first);
      setCurrentProject("73d1f165-c7e2-4ef9-a799-bd99a81a7c2b", environment);
      expect(readStokeSettings(environment)).toEqual({
        deviceId: first.id,
        deviceName: "Benjamin's MacBook",
        currentProjectId: "73d1f165-c7e2-4ef9-a799-bd99a81a7c2b",
      });
    } finally {
      rmSync(stokeHome, { recursive: true, force: true });
    }
  });

  test("resolves managed projects by slug, GitHub source, name, and checkout path", () => {
    const root = mkdtempSync(join(tmpdir(), "stoke-selector-"));
    const project = {
      id: "73d1f165-c7e2-4ef9-a799-bd99a81a7c2b",
      slug: "vercel-next-js",
      name: "next.js",
      source: { kind: "github" as const, owner: "vercel", repository: "next.js" },
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    const checkout = {
      id: "a73d1f16-c7e2-4ef9-a799-bd99a81a7c2b",
      projectId: project.id,
      deviceId: "device-1",
      deviceName: "MacBook",
      path: realpathSync(root),
      createdAt: "2026-08-04T00:00:00.000Z",
      lastSeenAt: "2026-08-04T00:00:00.000Z",
    };
    try {
      expect(resolveManagedProjectSelector(project.slug, [project], [checkout])).toEqual(project);
      expect(resolveManagedProjectSelector("vercel/next.js", [project], [checkout])).toEqual(project);
      expect(resolveManagedProjectSelector("next.js", [project], [checkout])).toEqual(project);
      expect(resolveManagedProjectSelector(root, [project], [checkout], { deviceId: "device-1" })).toEqual(project);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds and lists managed projects through the CLI", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    const gitInit = Bun.spawnSync(["git", "init", "-q"], { cwd });
    expect(gitInit.exitCode).toBe(0);
    const gitRemote = Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:vercel/next.js.git"], { cwd });
    expect(gitRemote.exitCode).toBe(0);
    const requests: Array<{ method: string; path: string; authorization: string | null; body?: unknown }> = [];
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
    const checkout = {
      id: "a73d1f16-c7e2-4ef9-a799-bd99a81a7c2b",
      projectId: project.id,
      deviceId: "device-1",
      deviceName: "Benjamin's MacBook",
      path: realpathSync(cwd),
      gitRemote: "git@github.com:vercel/next.js.git",
      createdAt: "2026-08-04T00:00:00.000Z",
      lastSeenAt: "2026-08-04T00:00:00.000Z",
    };
    let projectCreated = false;
    let checkoutCreated = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = request.method === "POST" ? await request.json() : undefined;
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          authorization: request.headers.get("authorization"),
          body,
        });
        if (url.pathname === "/api/v1/devices") {
          const input = body as { id: string; name: string };
          return Response.json({
            device: {
              ...input,
              createdAt: "2026-08-04T00:00:00.000Z",
              lastSeenAt: "2026-08-04T00:00:00.000Z",
            },
          });
        }
        if (url.pathname === "/api/v1/checkouts" && request.method === "POST") {
          checkoutCreated = true;
          return Response.json({ checkout });
        }
        if (url.pathname === "/api/v1/checkouts") {
          return Response.json({ checkouts: checkoutCreated ? [checkout] : [] });
        }
        if (url.pathname === "/api/v1/projects" && request.method === "POST") {
          projectCreated = true;
          return Response.json({ project });
        }
        if (url.pathname === "/api/v1/projects") {
          return Response.json({ projects: projectCreated ? [project] : [] });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      },
    });

    try {
      const environment = {
        STOKE_API_URL: `http://127.0.0.1:${server.port}`,
        STOKE_TOKEN: "test-secret",
        STOKE_HOME: join(cwd, ".stoke"),
        STOKE_DEVICE_ID: "device-1",
        STOKE_DEVICE_NAME: "Benjamin's MacBook",
      };
      const added = await runManagedCli(["add", ".", "--json"], cwd, environment);
      const listed = await runManagedCli(["ls", "--json"], cwd, environment);

      expect(added.exitCode).toBe(0);
      expect(JSON.parse(added.stdout)).toEqual({
        project,
        checkout,
        created: true,
        currentProjectId: project.id,
      });
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual({
        projects: [project],
        checkouts: [checkout],
        currentProjectId: project.id,
      });
      expect(requests).toEqual([
        {
          method: "POST",
          path: "/api/v1/devices",
          authorization: "Bearer test-secret",
          body: { id: "device-1", name: "Benjamin's MacBook" },
        },
        {
          method: "GET",
          path: "/api/v1/projects",
          authorization: "Bearer test-secret",
          body: undefined,
        },
        {
          method: "GET",
          path: "/api/v1/checkouts?deviceId=device-1",
          authorization: "Bearer test-secret",
          body: undefined,
        },
        {
          method: "POST",
          path: "/api/v1/projects",
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
        {
          method: "POST",
          path: "/api/v1/checkouts",
          authorization: "Bearer test-secret",
          body: {
            projectId: project.id,
            deviceId: "device-1",
            path: realpathSync(cwd),
            gitRemote: "git@github.com:vercel/next.js.git",
            relink: false,
          },
        },
        {
          method: "POST",
          path: "/api/v1/devices",
          authorization: "Bearer test-secret",
          body: { id: "device-1", name: "Benjamin's MacBook" },
        },
        { method: "GET", path: "/api/v1/projects", authorization: "Bearer test-secret", body: undefined },
        {
          method: "GET",
          path: "/api/v1/checkouts?deviceId=device-1",
          authorization: "Bearer test-secret",
          body: undefined,
        },
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
