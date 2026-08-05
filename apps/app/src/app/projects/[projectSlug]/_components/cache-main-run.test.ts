import { describe, expect, test } from "bun:test";
import type { ManagedRun } from "@usestoke/managed";
import { latestRemoteMainRun } from "./cache-main-run.ts";

describe("remote main cache run", () => {
  test("ignores a newer local checkout run", () => {
    const remote = run("remote", "dashboard", "2026-08-05T12:00:00.000Z");
    const checkout = run("checkout", "machine", "2026-08-05T12:05:00.000Z");

    expect(latestRemoteMainRun([checkout, remote])?.id).toBe(remote.id);
  });

  test("uses the newest completed remote plan or apply", () => {
    const older = run("older", "cli", "2026-08-05T12:00:00.000Z");
    const newer = run("newer", "dashboard", "2026-08-05T12:05:00.000Z");

    expect(latestRemoteMainRun([older, newer])?.id).toBe(newer.id);
  });
});

function run(id: string, origin: ManagedRun["origin"], startedAt: string): ManagedRun {
  return {
    id: `00000000-0000-4000-8000-0000000000${id === "remote" || id === "older" ? "01" : "02"}`,
    projectId: "00000000-0000-4000-8000-000000000003",
    origin,
    operation: "apply",
    workflow: "stoke-example",
    fingerprint: id,
    status: "completed",
    startedAt,
    updatedAt: startedAt,
  };
}
