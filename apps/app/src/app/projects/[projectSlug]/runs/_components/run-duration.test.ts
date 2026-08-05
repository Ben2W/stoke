import { describe, expect, test } from "bun:test";
import { formatDuration, formatRunDuration } from "./run-duration.ts";

describe("run duration", () => {
  test("formats operation completion timing", () => {
    expect(formatDuration(636)).toBe("636ms");
    expect(formatDuration(2_049)).toBe("2.0s");
    expect(formatDuration(15_565)).toBe("16s");
    expect(formatDuration(72_000)).toBe("1m 12s");
  });

  test("uses the completed timestamp when available", () => {
    expect(formatRunDuration({
      startedAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:03.000Z",
      completedAt: "2026-08-05T00:00:02.500Z",
    })).toBe("2.5s");
  });
});
