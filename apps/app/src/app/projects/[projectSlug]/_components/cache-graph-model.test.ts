import { describe, expect, test } from "bun:test";
import type { ManagedCacheEntry, ManagedRun } from "@usestoke/managed";
import { projectCacheGraph } from "./cache-graph-model.ts";
import type { RunTaskFlow } from "../runs/_components/run-task-flow.ts";

describe("live cache graph", () => {
  test("uses plan nodes as the graph's current branch", () => {
    const unrelated = cacheEntry("old", "old-task");
    const cached = cacheEntry("cached-run", "resolve");
    const flow = taskFlow([
      task("resolve", "cached", "cached-run"),
      task("install", "pending"),
      task("verify", "pending"),
    ]);

    const graph = projectCacheGraph([unrelated, cached], { flow, run: managedRun("plan", "completed") });
    expect(graph.entries.map((entry) => entry.nodePath)).toEqual(["resolve", "install", "verify"]);
    expect(graph.entries[1]!.upstreamRunIds).toEqual(["cached-run"]);
    expect(graph.entries[2]!.upstreamRunIds).toEqual([graph.entries[1]!.id]);
    expect(graph.activities.get(graph.entries[1]!.id)?.status).toBe("pending");
  });

  test("plays active apply states over the planned graph", () => {
    const plan = taskFlow([task("resolve", "pending"), task("install", "pending")]);
    const active = taskFlow([task("resolve", "completed", "new-resolve"), task("install", "running")]);
    const graph = projectCacheGraph([], { flow: plan, run: managedRun("plan", "completed") }, { flow: active, run: managedRun("apply", "running") });

    expect(graph.entries).toHaveLength(2);
    expect(graph.activities.get(graph.entries[0]!.id)?.status).toBe("completed");
    expect(graph.activities.get(graph.entries[1]!.id)?.status).toBe("running");
  });
});

function managedRun(operation: "plan" | "apply", status: "completed" | "running"): ManagedRun {
  return {
    id: `00000000-0000-4000-8000-00000000000${operation === "plan" ? 1 : 2}`,
    projectId: "00000000-0000-4000-8000-000000000003",
    origin: "dashboard",
    operation,
    workflow: "web",
    fingerprint: "remote:1234567890",
    status,
    startedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:10.000Z",
  };
}

function task(nodePath: string, status: "cached" | "completed" | "pending" | "running", runId?: string) {
  return { nodePath, status, runId, upstreamRunIds: [], output: [] };
}

function taskFlow(tasks: ReturnType<typeof task>[]): RunTaskFlow {
  return {
    cachedTaskCount: tasks.filter((task) => task.status === "cached").length,
    completedTaskCount: tasks.filter((task) => task.status === "cached" || task.status === "completed").length,
    tasks,
    workflowOutput: [],
  };
}

function cacheEntry(id: string, nodePath: string): ManagedCacheEntry {
  return {
    id,
    scope: "project",
    workflow: "web",
    nodePath,
    nodeName: nodePath,
    nodeKind: "task",
    fingerprint: `cache:${id}`,
    upstreamRunIds: [],
    invalidated: false,
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}
