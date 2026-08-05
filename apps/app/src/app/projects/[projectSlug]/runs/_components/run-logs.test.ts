import { describe, expect, test } from "bun:test";
import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { projectRunLogs } from "./run-logs.ts";

const run: ManagedRun = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  origin: "dashboard",
  operation: "run",
  workflow: "example",
  workspace: "demo",
  workspaceOperation: "test",
  fingerprint: "remote:fingerprint",
  status: "failed",
  error: "Tests failed",
  startedAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:02.000Z",
  completedAt: "2026-08-05T10:00:02.000Z",
};

function event(id: number, type: string, data: Record<string, unknown>): ManagedRunEvent {
  return { id, runId: run.id, type, data: { type, ...data }, createdAt: `2026-08-05T10:00:0${id}.000Z` };
}

describe("run log projection", () => {
  test("combines chunked persisted failure logs and includes the terminal error", () => {
    const lines = projectRunLogs([
      event(1, "remote.command.started", { command: "run" }),
      event(2, "remote.log.output", { data: "first half ", path: ".stoke/logs/run.log", stream: "log" }),
      event(3, "remote.log.output", { data: "second half", path: ".stoke/logs/run.log", stream: "log" }),
      event(4, "run.failed", { error: { message: "Tests failed" } }),
    ], run);

    expect(lines.map((line) => line.message)).toEqual([
      "Starting run",
      "first half second half",
      "Tests failed",
    ]);
    expect(lines[1]?.source).toBe(".stoke/logs/run.log");
  });

  test("projects dashboard capability feedback into the log stream", () => {
    const lines = projectRunLogs([
      event(1, "host.capability.request", { capability: "browser.open", params: { url: "https://example.com", displayName: "Open development preview" } }),
      event(2, "host.capability.request", { capability: "ssh" }),
    ], { ...run, status: "completed", error: null });

    expect(lines.map((line) => line.message)).toEqual([
      "Open development preview ready",
      "Opening SSH session…",
    ]);
  });
});
