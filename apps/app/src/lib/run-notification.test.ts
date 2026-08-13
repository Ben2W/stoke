import { describe, expect, test } from "bun:test";
import { parseRunNotification } from "./run-notification.ts";

describe("dashboard run notifications", () => {
  test("targets a changed run's event stream", () => {
    expect(parseRunNotification({ type: "run.changed", runId: "run-1" }))
      .toEqual({ type: "run.changed", runId: "run-1" });
  });

  test("accepts catch-up notifications and rejects malformed run changes", () => {
    expect(parseRunNotification({ type: "runs.changed" })).toEqual({ type: "runs.changed" });
    expect(parseRunNotification({ type: "run.changed" })).toBeUndefined();
    expect(parseRunNotification("run.changed")).toBeUndefined();
  });
});
