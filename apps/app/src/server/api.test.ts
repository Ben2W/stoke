import { describe, expect, test } from "bun:test";
import type { ManagedCheckout, ManagedProject, ManagedRun, ManagedRunEvent } from "@stoke/managed";
import { AuthenticationError } from "./auth.ts";
import { createApi } from "./api.ts";
import { ManagedResourceConflictError } from "./devices.ts";

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
