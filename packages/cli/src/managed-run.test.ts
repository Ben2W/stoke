import { describe, expect, test } from "bun:test";
import type { ManagedClient, ManagedRun } from "@usestoke/managed";
import {
  createManagedRunPublisher,
  followManagedRun,
  type ManagedApplyClaim,
} from "./managed-run.ts";

const run: ManagedRun = {
  id: "2923c579-7457-410c-a5bb-d47cd7131f0a",
  projectId: "f95df42b-48da-4a02-926b-60def0ee77cf",
  origin: "machine",
  operation: "apply",
  workflow: "default",
  fingerprint: "sha256-example",
  status: "running",
  startedAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  completedAt: null,
};

describe("managed run HTTP transport", () => {
  test("publishes events through the managed API with an idempotency key", async () => {
    const requests: unknown[] = [];
    const client = {
      appendRunEvent: async (runId: string, input: unknown) => {
        requests.push({ runId, input });
        return {
          id: 1,
          runId,
          type: "node.started",
          data: { type: "node.started" },
          createdAt: "2026-08-04T00:00:01.000Z",
        };
      },
      heartbeatRun: async () => undefined,
    } as unknown as ManagedClient;
    const publisher = createManagedRunPublisher(client, run.id, true);

    await publisher.publish({ type: "node.started" }, true);
    publisher.close();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      runId: run.id,
      input: {
        clientEventId: expect.any(String),
        event: { type: "node.started" },
      },
    });
  });

  test("follows a joined run by polling authoritative events and status", async () => {
    const observed: unknown[] = [];
    const client = {
      listRunEvents: async () => [{
        id: 1,
        runId: run.id,
        type: "node.completed",
        data: { type: "node.completed", nodePath: "build" },
        createdAt: "2026-08-04T00:00:01.000Z",
      }],
      getRun: async () => ({ ...run, status: "completed" as const }),
    } as unknown as ManagedClient;
    const claim: ManagedApplyClaim = { client, run, disposition: "joined" };

    const completed = await followManagedRun(claim, (event) => observed.push(event));

    expect(completed.status).toBe("completed");
    expect(observed).toEqual([{ type: "node.completed", nodePath: "build" }]);
  });
});
