import { describe, expect, test } from "bun:test";
import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { respondToRunCapability } from "./run-capabilities.ts";

const run: ManagedRun = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  origin: "dashboard",
  operation: "run",
  workflow: "example",
  workspace: "demo",
  workspaceOperation: "preview",
  fingerprint: "remote:test",
  status: "running",
  startedAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z",
  completedAt: null,
};

const request: ManagedRunEvent = {
  id: 1,
  runId: run.id,
  type: "host.capability.request",
  data: {
    type: "host.capability.request",
    id: "cap_req_preview",
    capability: "browser.open",
    params: { url: "https://preview.example", displayName: "Open preview" },
  },
  createdAt: "2026-08-05T10:00:01.000Z",
};

describe("dashboard run capabilities", () => {
  test("persists an acknowledgement only after a matching request", async () => {
    const appended: unknown[] = [];
    const response = await respondToRunCapability("user-1", run.id, "cap_req_preview", {
      result: { opened: true },
    }, {
      getRun: async () => run,
      listRunEvents: async () => [request],
      appendRunEvent: async (_userId, _runId, event) => {
        appended.push(event);
        return {
          id: 2,
          runId: run.id,
          type: "host.capability.response",
          data: event as Record<string, unknown>,
          createdAt: "2026-08-05T10:00:02.000Z",
        };
      },
    });

    expect(response.data).toMatchObject({
      requestId: "cap_req_preview",
      capability: "browser.open",
      result: { opened: true },
    });
    expect(appended).toHaveLength(1);
  });

  test("rejects an acknowledgement for an unknown request", async () => {
    expect(respondToRunCapability("user-1", run.id, "cap_req_missing", {
      result: { opened: true },
    }, {
      getRun: async () => run,
      listRunEvents: async () => [],
    })).rejects.toThrow("not found");
  });

  test("rejects an acknowledgement after the request expires", async () => {
    expect(respondToRunCapability("user-1", run.id, "cap_req_preview", {
      result: { opened: true },
    }, {
      getRun: async () => run,
      listRunEvents: async () => [{
        ...request,
        data: { ...request.data, expiresAt: "2026-08-05T09:59:59.000Z" },
      }],
    })).rejects.toThrow("expired");
  });
});
