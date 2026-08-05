import { describe, expect, test } from "bun:test";
import type { ManagedCheckout, ManagedProject, ManagedRun } from "@stoke/managed";
import { executeRemoteProject } from "./remote-executions.ts";

const project: ManagedProject = {
  id: "f95df42b-48da-4a02-926b-60def0ee77cf",
  slug: "ben2w-stoke-example",
  name: "stoke-example",
  source: { kind: "github", owner: "ben2w", repository: "stoke-example" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const checkout: ManagedCheckout = {
  id: "09f90166-18fb-4851-a31c-6a4dac353215",
  projectId: project.id,
  deviceId: "vercel-sandbox:test",
  deviceName: "Vercel Sandbox",
  path: `vercel-sandbox://${project.id}`,
  createdAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: "2026-08-01T00:00:00.000Z",
};

const running: ManagedRun = {
  id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
  projectId: project.id,
  checkoutId: checkout.id,
  deviceId: checkout.deviceId,
  deviceName: checkout.deviceName,
  operation: "plan",
  workflow: "default",
  fingerprint: "remote-test",
  status: "running",
  startedAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  completedAt: null,
};

describe("remote managed execution", () => {
  test("claims a cloud run and publishes sandbox lifecycle events", async () => {
    const events: unknown[] = [];
    const plan = {
      workflow: "stoke-example",
      nodeCount: 3,
      cachedNodeCount: 0,
      nodes: [],
    };
    const result = await executeRemoteProject("user-1", project.id, { operation: "plan" }, {
      getProject: async () => project,
      registerDevice: async (_userId, input) => ({
        ...input,
        createdAt: "2026-08-04T00:00:00.000Z",
        lastSeenAt: "2026-08-04T00:00:00.000Z",
      }),
      registerCheckout: async (_userId, input) => ({
        ...checkout,
        projectId: input.projectId,
        deviceId: input.deviceId,
        path: input.path,
      }),
      claimRun: async (_userId, input) => {
        expect(input).toMatchObject({
          projectId: project.id,
          checkoutId: checkout.id,
          operation: "plan",
          workflow: "default",
        });
        return { run: running, disposition: "created" };
      },
      getRun: async () => ({
        ...running,
        workflow: "stoke-example",
        status: "completed",
        nodeCount: 3,
        cachedNodeCount: 0,
      }),
      appendRunEvent: async (_userId, _runId, event) => {
        events.push(event);
        return {
          id: events.length,
          runId: running.id,
          type: (event as { type: string }).type,
          data: event as Record<string, unknown>,
          createdAt: "2026-08-04T00:00:00.000Z",
        };
      },
      heartbeatRun: async () => undefined,
      findGitHubAccessToken: async () => "github-token",
      runSandbox: async (input) => {
        expect(input.githubToken).toBe("github-token");
        await input.onStage?.({ type: "remote.sandbox.created", sandboxName: "test-sandbox" });
        return plan;
      },
    });

    expect(result).toMatchObject({ disposition: "created", result: plan });
    expect(events).toEqual([
      { type: "remote.sandbox.created", sandboxName: "test-sandbox" },
      {
        type: "plan.created",
        workflow: "stoke-example",
        nodeCount: 3,
        cachedNodeCount: 0,
      },
      { type: "run.completed" },
    ]);
  });
});
