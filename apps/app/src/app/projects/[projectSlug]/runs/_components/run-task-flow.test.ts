import { describe, expect, test } from "bun:test";
import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { projectRunTaskFlow } from "./run-task-flow.ts";

describe("managed run task flow", () => {
  test("collapses remote setup and excludes discovery workflow noise", () => {
    const events = [
      event(1, "remote.sandbox.created", { sandboxName: "sandbox" }),
      event(2, "remote.command.started", { command: "discover-workflow" }),
      event(3, "node.cached", { nodePath: "duplicate-discovery-task", runId: "old" }),
      event(4, "remote.command.completed", { command: "discover-workflow" }),
      event(5, "remote.command.started", { command: "apply" }),
      event(6, "workflow.apply.started", { workflow: "web" }),
      event(7, "node.cached", { nodePath: "install", runId: "cached-run" }),
      event(8, "workflow.apply.completed", { workflow: "web" }),
    ];

    expect(projectRunTaskFlow(events, run())).toMatchObject({
      setup: { status: "completed" },
      cachedTaskCount: 1,
      completedTaskCount: 1,
      tasks: [{ nodePath: "install", status: "cached", runId: "cached-run", output: [] }],
    });
  });

  test("keeps one task row and nests its command and console output", () => {
    const events = [
      event(1, "node.started", { nodePath: "verify" }),
      event(2, "command.started", { nodePath: "verify", command: "bun test" }),
      event(3, "command.output", { nodePath: "verify", stream: "stdout", data: "2 tests passed\n" }),
      event(4, "log.output", { nodePath: "verify", stream: "warn", data: "checking types" }),
      event(5, "node.completed", { nodePath: "verify", runId: "new-run" }),
    ];

    const flow = projectRunTaskFlow(events, run({ origin: "cli" }));
    expect(flow.setup).toBeUndefined();
    expect(flow.tasks).toHaveLength(1);
    expect(flow.tasks[0]).toMatchObject({ nodePath: "verify", status: "completed", runId: "new-run" });
    expect(flow.tasks[0]!.output.map((output) => [output.kind, output.stream, output.text])).toEqual([
      ["command", undefined, "$ bun test"],
      ["command", "stdout", "2 tests passed\n"],
      ["log", "warn", "checking types"],
    ]);
  });

  test("marks the active task failed with the run", () => {
    const flow = projectRunTaskFlow(
      [event(1, "node.started", { nodePath: "deploy" })],
      run({ status: "failed" }),
    );
    expect(flow.tasks[0]!.status).toBe("failed");
  });

  test("projects returned plan nodes without pretending they ran", () => {
    const flow = projectRunTaskFlow([
      event(1, "plan.nodes", {
        workflow: "web",
        nodes: [
          { index: 0, path: "resolve", name: "resolve", status: "cached", runId: "cached-run", upstreamRunIds: [] },
          { index: 1, path: "install", name: "install", status: "pending", upstreamRunIds: ["cached-run"] },
        ],
      }),
    ], run({ operation: "plan" }));

    expect(flow.tasks.map((task) => [task.nodePath, task.status, task.upstreamRunIds])).toEqual([
      ["resolve", "cached", []],
      ["install", "pending", ["cached-run"]],
    ]);
  });

  test("streams workspace operation logs into one completed task", () => {
    const flow = projectRunTaskFlow([
      event(1, "remote.command.started", { command: "run" }),
      event(2, "workspace.operation.started", { workspaceName: "demo", operationId: "test" }),
      event(3, "log.output", { nodePath: "workspace.demo.test", stream: "info", data: "$ npm test" }),
      event(4, "log.output", { nodePath: "workspace.demo.test", stream: "info", data: "2 tests passed" }),
      event(5, "workspace.operation.completed", { workspaceName: "demo", operationId: "test" }),
    ], run({ operation: "run", status: "completed" }));

    expect(flow.tasks).toEqual([
      expect.objectContaining({
        nodePath: "workspace.demo.test",
        status: "completed",
        output: [
          expect.objectContaining({ text: "$ npm test" }),
          expect.objectContaining({ text: "2 tests passed" }),
        ],
      }),
    ]);
  });
});

function run(overrides: Partial<ManagedRun> = {}): ManagedRun {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    origin: "dashboard",
    operation: "apply",
    workflow: "web",
    fingerprint: "remote:1234567890",
    status: "completed",
    startedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:10.000Z",
    ...overrides,
  };
}

function event(id: number, type: string, data: Record<string, unknown>): ManagedRunEvent {
  return {
    id,
    runId: "00000000-0000-4000-8000-000000000001",
    type,
    data: { type, ...data },
    createdAt: `2026-08-05T00:00:${String(id).padStart(2, "0")}.000Z`,
  };
}
