import { describe, expect, test } from "bun:test";
import type { ManagedProject, ManagedRun } from "@stoke/managed";
import { executeRemoteProject } from "./remote-executions.ts";

const project: ManagedProject = {
  id: "f95df42b-48da-4a02-926b-60def0ee77cf",
  slug: "ben2w-stoke-example",
  name: "stoke-example",
  source: { kind: "github", owner: "ben2w", repository: "stoke-example" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const running: ManagedRun = {
  id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
  projectId: project.id,
  origin: "dashboard",
  operation: "plan",
  workflow: "default",
  fingerprint: "remote-test",
  status: "running",
  startedAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  completedAt: null,
};

const managedState = { revision: 0, snapshot: { version: 1 as const, scopes: {} } };

describe("remote managed execution", () => {
  test("claims a cloud run and publishes sandbox lifecycle events", async () => {
    const events: unknown[] = [];
    const plan = {
      workflow: "stoke-example",
      nodeCount: 3,
      cachedNodeCount: 0,
      nodes: [],
    };
    const result = await executeRemoteProject("user-1", project.id, { operation: "plan", origin: "dashboard" }, {
      getProject: async () => project,
      claimRemoteRun: async (_userId, input) => {
        expect(input).toMatchObject({
          projectId: project.id,
          operation: "plan",
          workflow: "default",
          origin: "dashboard",
        });
        return { run: running, disposition: "created" };
      },
      getRun: async () => {
        const completed = events.some((event) => (event as { type?: string }).type === "run.completed");
        return {
          ...running,
          workflow: "stoke-example",
          status: completed ? "completed" : "running",
          ...(completed ? { nodeCount: 3, cachedNodeCount: 0 } : {}),
        };
      },
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
      getProjectState: async () => managedState,
      updateProjectState: async (_userId, _projectId, input) => ({
        revision: input.expectedRevision + 1,
        snapshot: input.snapshot,
      }),
      resolveGitHubRevision: async () => "e587a05a934ac7be12bf5233102939d4479f8625",
      runSandbox: async (input) => {
        expect(input.revision).toBe("e587a05a934ac7be12bf5233102939d4479f8625");
        await input.onStage?.({ type: "remote.sandbox.created", sandboxName: "test-sandbox" });
        return { result: plan, state: managedState };
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

  test("records apply summaries from the nested plan", async () => {
    const events: unknown[] = [];
    const applyRun = { ...running, operation: "apply" as const };
    await executeRemoteProject("user-1", project.id, { operation: "apply", origin: "cli" }, {
      getProject: async () => project,
      claimRemoteRun: async () => ({ run: { ...applyRun, origin: "cli" }, disposition: "created" }),
      getRun: async () => ({ ...applyRun, status: "completed" }),
      appendRunEvent: async (_userId, _runId, event) => {
        events.push(event);
        return {
          id: events.length,
          runId: applyRun.id,
          type: (event as { type: string }).type,
          data: event as Record<string, unknown>,
          createdAt: "2026-08-04T00:00:00.000Z",
        };
      },
      heartbeatRun: async () => undefined,
      getProjectState: async () => managedState,
      updateProjectState: async (_userId, _projectId, input) => ({
        revision: input.expectedRevision + 1,
        snapshot: input.snapshot,
      }),
      resolveGitHubRevision: async () => "e587a05a934ac7be12bf5233102939d4479f8625",
      runSandbox: async () => ({
        result: {
          context: {},
          plan: { workflow: "stoke-example", nodeCount: 3, cachedNodeCount: 0, nodes: [] },
        },
        state: managedState,
      }),
    });

    expect(events).toContainEqual({
      type: "workflow.apply.completed",
      workflow: "stoke-example",
      nodeCount: 3,
      cachedNodeCount: 0,
    });
  });
});
