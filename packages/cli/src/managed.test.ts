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

  test("adds, lists, and removes managed projects through the CLI", async () => {
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
        if (url.pathname === `/api/v1/projects/${project.id}` && request.method === "DELETE") {
          projectCreated = false;
          checkoutCreated = false;
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
      const listed = await runManagedCli(["project", "ls", "--json"], cwd, environment);
      const removed = await runManagedCli(
        ["project", "rm", project.slug, "--yes", "--json"],
        cwd,
        environment,
      );

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
      expect(removed.exitCode).toBe(0);
      expect(JSON.parse(removed.stdout)).toEqual({
        project,
        clearedCurrentProject: true,
        localDirectoriesDeleted: false,
        githubRepositoryDeleted: false,
      });
      expect(readStokeSettings(environment)?.currentProjectId).toBeUndefined();
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
        { method: "GET", path: "/api/v1/projects", authorization: "Bearer test-secret", body: undefined },
        {
          method: "GET",
          path: "/api/v1/checkouts?deviceId=device-1",
          authorization: "Bearer test-secret",
          body: undefined,
        },
        {
          method: "DELETE",
          path: `/api/v1/projects/${project.id}`,
          authorization: "Bearer test-secret",
          body: undefined,
        },
      ]);
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("lists managed state when the selected project has no checkout on this device", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-remote-list-"));
    const project = {
      id: "73d1f165-c7e2-4ef9-a799-bd99a81a7c2b",
      slug: "ben2w-stoke-example",
      name: "stoke-example",
      source: {
        kind: "github" as const,
        owner: "ben2w",
        repository: "stoke-example",
        url: "https://github.com/ben2w/stoke-example",
      },
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/devices") {
          const input = await request.json() as { id: string; name: string };
          return Response.json({
            device: {
              ...input,
              createdAt: "2026-08-04T00:00:00.000Z",
              lastSeenAt: "2026-08-04T00:00:00.000Z",
            },
          });
        }
        if (url.pathname === "/api/v1/projects") return Response.json({ projects: [project] });
        if (url.pathname === `/api/v1/projects/${project.id}/executions`) {
          return Response.json({
            run: {
              id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
              projectId: project.id,
              origin: "cli",
              operation: "plan",
              workflow: "stoke-example",
              fingerprint: "remote-test",
              status: "completed",
              nodeCount: 3,
              cachedNodeCount: 0,
              startedAt: "2026-08-04T00:00:00.000Z",
              updatedAt: "2026-08-04T00:00:01.000Z",
              completedAt: "2026-08-04T00:00:01.000Z",
            },
            disposition: "created",
            result: {
              workflow: "stoke-example",
              providerFingerprint: "test",
              nodeCount: 3,
              cachedNodeCount: 0,
              nodes: [],
            },
          });
        }
        if (url.pathname === "/api/v1/checkouts") return Response.json({ checkouts: [] });
        if (url.pathname === "/api/v1/runs") return Response.json({ runs: [] });
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
      setCurrentProject(project.id, environment);
      const result = await runManagedCli(["ls", "--json"], cwd, environment);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        project,
        execution: {
          kind: "unavailable",
          reason: "no_checkout",
          deviceId: "device-1",
          deviceName: "Benjamin's MacBook",
        },
        workflows: [],
      });

      const planned = await runManagedCli(["plan", "--json"], cwd, environment);
      expect(planned.exitCode).toBe(0);
      expect(planned.stderr).toBe("");
      expect(JSON.parse(planned.stdout)).toMatchObject({
        workflow: "stoke-example",
        nodeCount: 3,
        cachedNodeCount: 0,
      });
    } finally {
      server.stop(true);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("requires an explicit choice when a local checkout matches an existing project", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-conflict-"));
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd }).exitCode).toBe(0);
    expect(Bun.spawnSync(
      ["git", "remote", "add", "origin", "git@github.com:vercel/next.js.git"],
      { cwd },
    ).exitCode).toBe(0);
    const existing = {
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
    const created = {
      ...existing,
      id: "83d1f165-c7e2-4ef9-a799-bd99a81a7c2b",
      slug: "vercel-next-js-2",
      name: "next-local",
    };
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST"
          ? await request.json().catch(() => undefined)
          : undefined;
        requests.push({ path: `${url.pathname}${url.search}`, method: request.method, body });
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
        if (url.pathname === "/api/v1/projects" && request.method === "POST") {
          return Response.json({ project: created });
        }
        if (url.pathname === `/api/v1/projects/${existing.id}/verify-source`) {
          return Response.json({ project: existing });
        }
        if (url.pathname === "/api/v1/projects") return Response.json({ projects: [existing] });
        if (url.pathname === "/api/v1/checkouts" && request.method === "POST") {
          const input = body as { projectId: string; deviceId: string; path: string; gitRemote?: string };
          return Response.json({
            checkout: {
              id: "a73d1f16-c7e2-4ef9-a799-bd99a81a7c2b",
              ...input,
              deviceName: "Benjamin's MacBook",
              createdAt: "2026-08-04T00:00:00.000Z",
              lastSeenAt: "2026-08-04T00:00:00.000Z",
            },
          });
        }
        if (url.pathname === "/api/v1/checkouts") return Response.json({ checkouts: [] });
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
      const ambiguous = await runManagedCli(["add", ".", "--json"], cwd, environment);
      expect(ambiguous.exitCode).toBe(1);
      expect(ambiguous.stderr).toContain("--project vercel-next-js");
      expect(ambiguous.stderr).toContain("--new --name <name>");

      const linked = await runManagedCli(
        ["add", ".", "--project", existing.slug, "--json"],
        cwd,
        environment,
      );
      expect(linked.exitCode).toBe(0);
      expect(JSON.parse(linked.stdout)).toMatchObject({ project: existing, created: false });
      expect(requests).toContainEqual({
        path: "/api/v1/checkouts",
        method: "POST",
        body: {
          projectId: existing.id,
          deviceId: "device-1",
          path: realpathSync(cwd),
          gitRemote: "git@github.com:vercel/next.js.git",
          relink: true,
        },
      });

      const separate = await runManagedCli(
        ["add", ".", "--new", "--name", "next-local", "--json"],
        cwd,
        environment,
      );
      expect(separate.exitCode).toBe(0);
      expect(JSON.parse(separate.stdout)).toMatchObject({ project: created, created: true });
      expect(requests).toContainEqual({
        path: "/api/v1/projects",
        method: "POST",
        body: {
          name: "next-local",
          source: existing.source,
          forceNew: true,
        },
      });
      expect(requests).toContainEqual({
        path: "/api/v1/checkouts",
        method: "POST",
        body: {
          projectId: created.id,
          deviceId: "device-1",
          path: realpathSync(cwd),
          gitRemote: "git@github.com:vercel/next.js.git",
          relink: true,
        },
      });
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
