import { describe, expect, test } from "bun:test";
import type { ManagedCheckout, ManagedProject, ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { AuthenticationError } from "./auth.ts";
import { createApi } from "./api.ts";
import { ManagedResourceConflictError } from "./devices.ts";
import { PublicGitHubRepositoryRequiredError } from "./github-repository.ts";

const user = {
  id: "user-1",
  name: "Benjamin Werner",
  email: "ben@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const project: ManagedProject = {
  id: "f95df42b-48da-4a02-926b-60def0ee77cf",
  slug: "ben2w-stoke",
  name: "stoke",
  source: { kind: "github", owner: "ben2w", repository: "stoke" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const checkout: ManagedCheckout = {
  id: "09f90166-18fb-4851-a31c-6a4dac353215",
  projectId: project.id,
  deviceId: "device-1",
  deviceName: "Benjamin's MacBook",
  path: "/Users/ben/stoke",
  createdAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: "2026-08-01T00:00:00.000Z",
};

const run: ManagedRun = {
  id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
  projectId: project.id,
  checkoutId: checkout.id,
  deviceId: checkout.deviceId,
  deviceName: checkout.deviceName,
  origin: "machine",
  operation: "apply",
  workflow: "default",
  fingerprint: "sha256-example",
  status: "running",
  startedAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  completedAt: null,
};

const runEvent: ManagedRunEvent = {
  id: 1,
  runId: run.id,
  type: "node.started",
  data: { type: "node.started", nodePath: "build" },
  createdAt: "2026-08-04T00:00:01.000Z",
};

describe("Hono control-plane API", () => {
  test("serves public health through the mounted base path", async () => {
    const response = await createApi().request("http://localhost/api/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      service: "stoke-control-plane",
      apiVersion: 1,
    });
  });

  test("shares authentication across managed routes", async () => {
    const api = createApi({
      authenticate: async () => user,
      listProjects: async (userId) => {
        expect(userId).toBe(user.id);
        return [project];
      },
      listCheckouts: async (userId, deviceId) => {
        expect(userId).toBe(user.id);
        expect(deviceId).toBe("device-1");
        return [checkout];
      },
    });

    const projectsResponse = await api.request("http://localhost/api/v1/projects");
    const checkoutsResponse = await api.request(
      "http://localhost/api/v1/checkouts?deviceId=device-1",
    );
    expect(projectsResponse.status).toBe(200);
    expect(await projectsResponse.json()).toEqual({ projects: [project] });
    expect(checkoutsResponse.status).toBe(200);
    expect(await checkoutsResponse.json()).toEqual({ checkouts: [checkout] });
  });

  test("deletes only a project owned by the authenticated user", async () => {
    const api = createApi({
      authenticate: async () => user,
      deleteProject: async (userId, projectId) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        return project;
      },
    });

    const response = await api.request(`http://localhost/api/v1/projects/${project.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project });
  });

  test("returns not found when deleting a project the user does not own", async () => {
    const api = createApi({
      authenticate: async () => user,
      deleteProject: async () => undefined,
    });

    const response = await api.request(`http://localhost/api/v1/projects/${project.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("verifies an existing project source", async () => {
    const api = createApi({
      authenticate: async () => user,
      verifyProjectSource: async (userId, projectId) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        return project;
      },
    });

    const response = await api.request(
      `http://localhost/api/v1/projects/${project.id}/verify-source`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project });
  });

  test("routes managed Sandbox lifecycle through the authenticated user", async () => {
    const calls: unknown[] = [];
    const api = createApi({
      authenticate: async () => user,
      createManagedSandbox: async (userId, input) => {
        calls.push(["create", userId, input.projectId]);
        return { name: "quiet-otter", domains: { "3000": "https://quiet-otter.example" } };
      },
      runManagedSandboxCommand: async (userId, name, input) => {
        calls.push(["command", userId, name, input.cmd]);
        return { exitCode: 0, stdout: "ok\n", stderr: "" };
      },
      stopManagedSandbox: async (userId, name, projectId) => {
        calls.push(["stop", userId, name, projectId]);
      },
      openManagedSandboxInteractive: async (userId, name, projectId) => {
        calls.push(["interactive", userId, name, projectId]);
        return { url: "wss://pty.example", token: "ticket" };
      },
    });
    const created = await api.request("http://localhost/api/v1/sandboxes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, runtime: "node24", ports: [3000] }),
    });
    const command = await api.request("http://localhost/api/v1/sandboxes/quiet-otter/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, cmd: "pwd" }),
    });
    const interactive = await api.request("http://localhost/api/v1/sandboxes/quiet-otter/interactive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    const stopped = await api.request(
      `http://localhost/api/v1/sandboxes/quiet-otter?projectId=${project.id}`,
      { method: "DELETE" },
    );

    expect([created.status, command.status, interactive.status, stopped.status]).toEqual([201, 200, 200, 200]);
    expect(calls).toEqual([
      ["create", user.id, project.id],
      ["command", user.id, "quiet-otter", "pwd"],
      ["interactive", user.id, "quiet-otter", project.id],
      ["stop", user.id, "quiet-otter", project.id],
    ]);
  });

  test("returns structured validation and authentication failures", async () => {
    const authenticated = createApi({ authenticate: async () => user });
    const invalid = await authenticated.request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "missing source" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_request" });

    const unauthenticated = createApi({
      authenticate: async () => {
        throw new AuthenticationError("Authentication required");
      },
    });
    const unauthorized = await unauthenticated.request("http://localhost/api/v1/projects");
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" });
  });

  test("passes explicit duplicate-project creation through the API", async () => {
    const api = createApi({
      authenticate: async () => user,
      createProject: async (userId, input) => {
        expect(userId).toBe(user.id);
        expect(input).toMatchObject({
          name: "stoke-preview",
          source: project.source,
          forceNew: true,
        });
        return { ...project, name: input.name, slug: "ben2w-stoke-2" };
      },
    });
    const response = await api.request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "stoke-preview",
        source: project.source,
        forceNew: true,
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      project: { name: "stoke-preview", slug: "ben2w-stoke-2" },
    });
  });

  test("returns a clear error for private GitHub project registration", async () => {
    const api = createApi({
      authenticate: async () => user,
      createProject: async () => {
        throw new PublicGitHubRepositoryRequiredError(
          "Only public GitHub repositories can be added to Stoke. Ben2W/stoke is private or unavailable.",
        );
      },
    });
    const response = await api.request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "stoke", source: project.source }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "public_github_repository_required",
      message: "Only public GitHub repositories can be added to Stoke. Ben2W/stoke is private or unavailable.",
    });
  });

  test("returns dashboard runs before their remote execution completes", async () => {
    const api = createApi({
      authenticate: async () => user,
      startRemoteProjectExecution: async (userId, projectId, input) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        expect(input).toEqual({ operation: "plan", workflow: "default", origin: "dashboard" });
        return {
          run: { ...run, operation: "plan", origin: "dashboard" },
          disposition: "created",
        };
      },
    });
    const response = await api.request(`http://localhost/api/v1/projects/${project.id}/executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "plan", workflow: "default", origin: "dashboard" }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      disposition: "created",
      run: { operation: "plan", status: "running" },
    });
  });

  test("keeps CLI remote execution responses synchronous", async () => {
    const result = { workflow: "default", nodeCount: 2, cachedNodeCount: 1, nodes: [] };
    const api = createApi({
      authenticate: async () => user,
      executeRemoteProject: async (_userId, _projectId, input) => ({
        run: { ...run, operation: input.operation, origin: "cli", status: "completed" },
        disposition: "created",
        result,
      }),
    });
    const response = await api.request(`http://localhost/api/v1/projects/${project.id}/executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "plan", workflow: "default", origin: "cli" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result });
  });

  test("reads and updates revisioned managed project state", async () => {
    const snapshot = { version: 1 as const, scopes: {} };
    const api = createApi({
      authenticate: async () => user,
      getProjectState: async (userId, projectId) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        return { revision: 4, snapshot };
      },
      updateProjectState: async (userId, projectId, input) => {
        expect([userId, projectId, input.expectedRevision]).toEqual([user.id, project.id, 4]);
        return { revision: 5, snapshot: input.snapshot };
      },
    });

    const read = await api.request(`http://localhost/api/v1/projects/${project.id}/state`);
    expect(await read.json()).toEqual({ revision: 4, snapshot });

    const updated = await api.request(`http://localhost/api/v1/projects/${project.id}/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4, snapshot }),
    });
    expect(await updated.json()).toEqual({ revision: 5, snapshot });
  });

  test("lists, invalidates, and clears managed cache", async () => {
    const cache = {
      revision: 2,
      entries: [{
        id: "run-1",
        scope: "project",
        workflow: "default",
        nodePath: "build",
        nodeName: "Build",
        nodeKind: "task",
        fingerprint: "cache:7d860e",
        upstreamRunIds: [],
        invalidated: false,
        createdAt: "2026-08-04T00:00:00.000Z",
      }],
    };
    const api = createApi({
      authenticate: async () => user,
      listProjectCache: async (userId, projectId) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        return cache;
      },
      invalidateProjectCache: async (userId, projectId, input) => {
        expect([userId, projectId, input]).toEqual([
          user.id,
          project.id,
          { scope: "project", entryId: "run-1" },
        ]);
        return { revision: 3, affected: 2 };
      },
      clearProjectCache: async () => ({ revision: 4, affected: 2 }),
    });

    const listed = await api.request(`http://localhost/api/v1/projects/${project.id}/cache`);
    expect(await listed.json()).toEqual(cache);
    const invalidated = await api.request(`http://localhost/api/v1/projects/${project.id}/cache/invalidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", entryId: "run-1" }),
    });
    expect(await invalidated.json()).toEqual({ revision: 3, affected: 2 });
    const cleared = await api.request(`http://localhost/api/v1/projects/${project.id}/cache`, { method: "DELETE" });
    expect(await cleared.json()).toEqual({ revision: 4, affected: 2 });
  });

  test("lists safe project workspaces for the dashboard", async () => {
    const workspace = {
      id: "workspace-1",
      projectId: project.id,
      name: "quiet-forest",
      workflow: "default",
      ctx: {},
      operations: [],
      createdFrom: {
        kind: "checkout" as const,
        deviceId: checkout.deviceId,
        deviceName: checkout.deviceName,
        checkoutId: checkout.id,
        checkoutPath: checkout.path,
      },
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:01:00.000Z",
    };
    const api = createApi({
      authenticate: async () => user,
      listProjectWorkspaces: async (userId, projectId) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        return [workspace];
      },
    });

    const response = await api.request(`http://localhost/api/v1/projects/${project.id}/workspaces`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [workspace] });
  });

  test("centralizes managed resource conflicts", async () => {
    const api = createApi({
      authenticate: async () => user,
      registerCheckout: async () => {
        throw new ManagedResourceConflictError("Checkout belongs to another project", {
          existingProjectId: "project-1",
        });
      },
    });
    const response = await api.request("http://localhost/api/v1/checkouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        deviceId: "device-1",
        path: "/Users/ben/stoke",
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "conflict",
      message: "Checkout belongs to another project",
      details: { existingProjectId: "project-1" },
    });
  });

  test("claims runs and exposes their live observation endpoints", async () => {
    const api = createApi({
      authenticate: async () => user,
      claimRun: async (userId, input) => {
        expect(userId).toBe(user.id);
        expect(input).toMatchObject({ projectId: project.id, checkoutId: checkout.id, operation: "apply" });
        return { run, disposition: "created" };
      },
      listRuns: async (userId, projectId) => {
        expect([userId, projectId]).toEqual([user.id, project.id]);
        return [run];
      },
      getRun: async (userId, runId) => {
        expect([userId, runId]).toEqual([user.id, run.id]);
        return run;
      },
      listRunEvents: async (userId, runId, after) => {
        expect([userId, runId, after]).toEqual([user.id, run.id, 0]);
        return [runEvent];
      },
    });

    const claim = await api.request("http://localhost/api/v1/runs/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        checkoutId: checkout.id,
        operation: "apply",
        workflow: "default",
        fingerprint: run.fingerprint,
      }),
    });
    expect(claim.status).toBe(201);
    expect(await claim.json()).toMatchObject({
      run,
      disposition: "created",
      socketUrl: expect.stringMatching(/^ws:\/\/localhost\/api\/ws\?ticket=/),
    });

    const listed = await api.request(`http://localhost/api/v1/runs?projectId=${project.id}`);
    expect(await listed.json()).toEqual({ runs: [run] });
    const events = await api.request(`http://localhost/api/v1/runs/${run.id}/events`);
    expect(await events.json()).toEqual({ events: [runEvent] });
    const ticket = await api.request(`http://localhost/api/v1/runs/${run.id}/ticket`, { method: "POST" });
    expect(await ticket.json()).toMatchObject({ socketUrl: expect.stringMatching(/^ws:\/\/localhost\/api\/ws\?ticket=/) });
  });
});
