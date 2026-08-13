import { describe, expect, test } from "bun:test";
import { parseRunChange } from "./run-notifications.ts";

describe("run notifications", () => {
  test("parses the small Postgres invalidation payload", () => {
    expect(parseRunChange(JSON.stringify({ runId: "run-1", userId: "user-1" })))
      .toEqual({ runId: "run-1", userId: "user-1" });
  });

  test("ignores malformed or incomplete notifications", () => {
    expect(parseRunChange("not-json")).toBeUndefined();
    expect(parseRunChange(JSON.stringify({ runId: "run-1" }))).toBeUndefined();
  });
});
