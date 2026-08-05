import { describe, expect, test } from "bun:test";
import { capabilityResponseMessage } from "./run-websocket.ts";

describe("managed run WebSocket relay", () => {
  test("projects a persisted capability acknowledgement for the evaluator", () => {
    expect(capabilityResponseMessage({
      type: "host.capability.response",
      requestId: "cap_req_preview",
      result: { opened: true },
    })).toEqual({
      type: "host.response",
      id: "cap_req_preview",
      result: { opened: true },
    });
    expect(capabilityResponseMessage({ type: "node.completed" })).toBeUndefined();
  });
});
