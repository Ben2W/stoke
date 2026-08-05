import { describe, expect, test } from "bun:test";
import type { ManagedRunEvent } from "@usestoke/managed";
import { pendingBrowserOpen } from "./run-capability-action.tsx";

function event(id: number, type: string, data: Record<string, unknown>): ManagedRunEvent {
  return {
    id,
    runId: "00000000-0000-4000-8000-000000000001",
    type,
    data: { type, ...data },
    createdAt: `2026-08-05T10:00:0${id}.000Z`,
  };
}

describe("run capability action", () => {
  test("shows a named browser link until it is acknowledged", () => {
    const request = event(1, "host.capability.request", {
      id: "cap_req_preview",
      capability: "browser.open",
      params: {
        url: "https://preview.example",
        displayName: "Open development preview",
      },
    });

    expect(pendingBrowserOpen([request])).toEqual({
      requestId: "cap_req_preview",
      url: "https://preview.example",
      displayName: "Open development preview",
    });
    expect(pendingBrowserOpen([
      request,
      event(2, "host.capability.response", {
        requestId: "cap_req_preview",
        result: { opened: true },
      }),
    ])).toBeUndefined();
  });
});
