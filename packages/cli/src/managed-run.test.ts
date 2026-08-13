import { describe, expect, test } from "bun:test";
import type { ManagedClient, ManagedRun } from "@usestoke/managed";
import {
  createManagedRunPublisher,
  followManagedRun,
  relayManagedHostResponses,
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

  test("catches up persisted host responses when notification delivery reconnects", async () => {
    const client = {
      listRunEvents: async () => [{
        id: 2,
        runId: run.id,
        type: "host.capability.response",
        data: {
          type: "host.capability.response",
          requestId: "cap_req_preview",
          result: { opened: true },
        },
        createdAt: "2026-08-04T00:00:02.000Z",
      }],
      heartbeatRun: async () => undefined,
    } as unknown as ManagedClient;
    const publisher = createManagedRunPublisher(client, run.id, true);

    const response = await new Promise<{ id: string; result?: unknown }>((resolve) => {
      publisher.onHostResponse(resolve);
    });
    publisher.close();

    expect(response).toEqual({ id: "cap_req_preview", result: { opened: true } });
  });

  test("retries a persisted host response until the runtime accepts it", async () => {
    const events = [
      {
        id: 1,
        runId: run.id,
        type: "host.capability.response",
        data: {
          type: "host.capability.response",
          requestId: "cap_req_first",
          result: { opened: true },
        },
        createdAt: "2026-08-04T00:00:01.000Z",
      },
      {
        id: 2,
        runId: run.id,
        type: "host.capability.response",
        data: {
          type: "host.capability.response",
          requestId: "cap_req_retry",
          result: { opened: true },
        },
        createdAt: "2026-08-04T00:00:02.000Z",
      },
    ];
    const client = {
      listRunEvents: async (_runId: string, after: number) =>
        events.filter((event) => event.id > after),
    } as unknown as ManagedClient;
    const cursor = { value: 0 };
    const attempts: string[] = [];
    let rejectRetry = true;
    const handler = async (response: { id: string }) => {
      attempts.push(response.id);
      if (response.id === "cap_req_retry" && rejectRetry) {
        rejectRetry = false;
        throw new Error("runtime request is not ready yet");
      }
    };

    await expect(relayManagedHostResponses(client, run.id, cursor, handler)).rejects.toThrow(
      "runtime request is not ready yet",
    );
    expect(cursor.value).toBe(1);

    await relayManagedHostResponses(client, run.id, cursor, handler);

    expect(cursor.value).toBe(2);
    expect(attempts).toEqual(["cap_req_first", "cap_req_retry", "cap_req_retry"]);
  });

  test("follows a joined run from authoritative events and status", async () => {
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
