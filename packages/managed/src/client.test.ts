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

const run = {
  id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
  projectId: project.id,
  checkoutId: "a73d1f16-c7e2-4ef9-a799-bd99a81a7c2b",
  deviceId: "device-1",
  deviceName: "Benjamin's MacBook",
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
      path: "/Users/ben/src/rigkit",
      gitRemote: "git@github.com:freestyle-sh/rigkit.git",
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

  test("claims and observes managed apply runs", async () => {
    const requests: Request[] = [];
    const event = {
      id: 1,
      runId: run.id,
      type: "node.started",
      data: { type: "node.started", nodePath: "build" },
      createdAt: "2026-08-04T00:00:01.000Z",
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
        if (request.url.endsWith("/events?after=1")) return Response.json({ events: [event] });
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
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`)).toEqual([
      "POST /api/v1/runs/claim",
      `GET /api/v1/runs?projectId=${project.id}`,
      `GET /api/v1/runs/${run.id}`,
      `GET /api/v1/runs/${run.id}/events?after=1`,
      `POST /api/v1/runs/${run.id}/ticket?role=viewer`,
    ]);
  });
});
