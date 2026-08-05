import { describe, expect, test } from "bun:test";
import { createManagedClient, ManagedApiError } from "./client.ts";

const project = {
  id: "fe055b36-1dbd-439a-9c11-21aab123ac74",
  slug: "vercel-sh-stoke",
  name: "Stoke",
  source: { kind: "github" as const, owner: "vercel-sh", repository: "stoke" },
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

const run = {
  id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
  projectId: project.id,
  checkoutId: "a73d1f16-c7e2-4ef9-a799-bd99a81a7c2b",
  deviceId: "device-1",
  deviceName: "Benjamin's MacBook",
  origin: "machine" as const,
  operation: "apply" as const,
  workflow: "default",
  fingerprint: "sha256-example",
  status: "running" as const,
  startedAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  completedAt: null,
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

  test("authenticates lazily and retries one unauthorized request", async () => {
    let token: string | undefined;
    let authentications = 0;
    const requests: Request[] = [];
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev",
      token: () => token,
      onUnauthorized: async () => {
        authentications += 1;
        token = "fresh";
        return token;
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return request.headers.get("authorization") === "Bearer fresh"
          ? Response.json({ projects: [project] })
          : Response.json({ error: "unauthorized" }, { status: 401 });
      },
    });

    expect(await client.listProjects()).toEqual([project]);
    expect(authentications).toBe(1);
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer fresh",
    ]);

    token = "expired";
    expect(await client.listProjects()).toEqual([project]);
    expect(authentications).toBe(2);
    expect(requests.slice(1).map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer expired",
      "Bearer fresh",
    ]);
  });

  test("verifies and deletes a managed project", async () => {
    const requests: Request[] = [];
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev",
      token: "secret",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ project });
      },
    });

    expect(await client.verifyProjectSource(project.id)).toEqual(project);
    expect(await client.deleteProject(project.id)).toEqual(project);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      `POST /api/v1/projects/${project.id}/verify-source`,
      `DELETE /api/v1/projects/${project.id}`,
    ]);
  });

  test("registers devices and project checkouts", async () => {
    const requests: Request[] = [];
    const device = {
      id: "device-1",
      name: "Benjamin's MacBook",
      createdAt: "2026-08-04T00:00:00.000Z",
      lastSeenAt: "2026-08-04T00:00:00.000Z",
    };
    const checkout = {
      id: "a73d1f16-c7e2-4ef9-a799-bd99a81a7c2b",
      projectId: project.id,
      deviceId: device.id,
      deviceName: device.name,
      path: "/Users/ben/src/stoke",
      gitRemote: "git@github.com:vercel-sh/stoke.git",
      createdAt: "2026-08-04T00:00:00.000Z",
      lastSeenAt: "2026-08-04T00:00:00.000Z",
    };
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev",
      token: "secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/devices")) return Response.json({ device });
        if (request.method === "POST") return Response.json({ checkout });
        return Response.json({ checkouts: [checkout] });
      },
    });

    expect(await client.registerDevice({ id: device.id, name: device.name })).toEqual(device);
    expect(await client.listCheckouts(device.id)).toEqual([checkout]);
    expect(await client.registerCheckout({
      projectId: project.id,
      deviceId: device.id,
      path: checkout.path,
      gitRemote: checkout.gitRemote,
    })).toEqual(checkout);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`)).toEqual([
      "POST /api/v1/devices",
      "GET /api/v1/checkouts?deviceId=device-1",
      "POST /api/v1/checkouts",
    ]);
  });

  test("creates and snapshots managed sandboxes", async () => {
    const requests: Request[] = [];
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev",
      token: "secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/snapshots")) {
          return Response.json({ snapshot: { snapshotId: "snap_prepared" } }, { status: 201 });
        }
        return Response.json({ sandbox: { name: "setup-sandbox", domains: {} } }, { status: 201 });
      },
    });

    expect(await client.createSandbox({
      projectId: project.id,
      source: { type: "empty" },
      runtime: "node24",
      ports: [],
    })).toEqual({ name: "setup-sandbox", domains: {} });
    expect(await client.snapshotSandbox("setup-sandbox", {
      projectId: project.id,
      expiration: 0,
    })).toEqual({ snapshotId: "snap_prepared" });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/v1/sandboxes",
      "POST /api/v1/sandboxes/setup-sandbox/snapshots",
    ]);
  });

  test("claims and observes managed apply runs", async () => {
    const requests: Request[] = [];
    const event = {
      id: 1,
      runId: run.id,
      type: "node.started",
      data: { type: "node.started", nodePath: "build" },
      createdAt: "2026-08-04T00:00:01.000Z",
    };
    const capabilityResponse = {
      ...event,
      id: 2,
      type: "host.capability.response",
      data: {
        type: "host.capability.response",
        requestId: "cap_req_preview",
        capability: "browser.open",
        result: { opened: true },
      },
    };
    const client = createManagedClient({
      baseUrl: "https://usestoke.dev",
      token: "secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/claim")) {
          return Response.json({ run, disposition: "created", socketUrl: "wss://usestoke.dev/api/ws?ticket=signed" }, { status: 201 });
        }
        if (request.url.endsWith(`/projects/${project.id}/executions`)) {
          return Response.json({
            run: { ...run, operation: "plan" },
            disposition: "created",
            result: { workflow: "default", nodeCount: 1, cachedNodeCount: 0, nodes: [] },
          });
        }
        if (request.url.endsWith(`/projects/${project.id}/state`)) {
          const body = request.method === "PUT" ? await request.json() as { snapshot: unknown } : undefined;
          return Response.json({
            revision: request.method === "PUT" ? 2 : 1,
            snapshot: body?.snapshot ?? { version: 1, scopes: {} },
          });
        }
        if (request.url.endsWith("/events?after=1")) return Response.json({ events: [event] });
        if (request.url.endsWith("/capabilities/cap_req_preview/respond")) {
          return Response.json({ event: capabilityResponse });
        }
        if (request.url.includes("/ticket?role=")) return Response.json({ socketUrl: "wss://usestoke.dev/api/ws?ticket=viewer" });
        if (request.url.includes("/runs/")) return Response.json({ run });
        return Response.json({ runs: [run] });
      },
    });

    expect(await client.claimRun({
      projectId: project.id,
      checkoutId: run.checkoutId,
      operation: "apply",
      workflow: "default",
      fingerprint: run.fingerprint,
    })).toMatchObject({ disposition: "created", run });
    expect(await client.listRuns(project.id)).toEqual([run]);
    expect(await client.getRun(run.id)).toEqual(run);
    expect(await client.listRunEvents(run.id, 1)).toEqual([event]);
    expect(await client.createRunSocketTicket(run.id)).toBe("wss://usestoke.dev/api/ws?ticket=viewer");
    expect(await client.respondRunCapability(run.id, "cap_req_preview", { result: { opened: true } }))
      .toEqual(capabilityResponse);
    expect(await client.executeProject(project.id, { operation: "plan", origin: "cli" })).toMatchObject({
      disposition: "created",
      result: { workflow: "default", nodeCount: 1 },
    });
    const state = await client.getProjectState(project.id);
    expect(state.revision).toBe(1);
    expect(await client.updateProjectState(project.id, state.revision, state.snapshot)).toMatchObject({ revision: 2 });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`)).toEqual([
      "POST /api/v1/runs/claim",
      `GET /api/v1/runs?projectId=${project.id}`,
      `GET /api/v1/runs/${run.id}`,
      `GET /api/v1/runs/${run.id}/events?after=1`,
      `POST /api/v1/runs/${run.id}/ticket?role=viewer`,
      `POST /api/v1/runs/${run.id}/capabilities/cap_req_preview/respond`,
      `POST /api/v1/projects/${project.id}/executions`,
      `GET /api/v1/projects/${project.id}/state`,
      `PUT /api/v1/projects/${project.id}/state`,
    ]);
  });
});
