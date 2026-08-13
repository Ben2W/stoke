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

  test("treats a cached plan result missing from the authoritative cache as invalidated", () => {
    const flow = taskFlow([
      task("resolve", "cached", "cleared-run"),
      task("install", "cached", "invalidated-run"),
    ]);

    const graph = projectCacheGraph([], { flow, run: managedRun("plan", "completed") });

    expect(graph.entries).toHaveLength(2);
    expect(graph.entries.every((entry) => entry.invalidated)).toBe(true);
    expect(graph.activities.size).toBe(0);
  });

  test("does not let historical cached activity override an invalidated entry", () => {
    const invalidated = { ...cacheEntry("invalidated-run", "resolve"), invalidated: true };
    const flow = taskFlow([task("resolve", "cached", invalidated.id)]);

    const graph = projectCacheGraph([invalidated], { flow, run: managedRun("plan", "completed") });

    expect(graph.entries[0]?.invalidated).toBe(true);
    expect(graph.activities.has(invalidated.id)).toBe(false);
  });

  test("does not let a bridged completed apply override cleared cache state", () => {
    const planned = taskFlow([task("resolve", "cached", "cleared-run")]);
    const completedApply = taskFlow([task("resolve", "completed", "cleared-run")]);

    const graph = projectCacheGraph(
      [],
      { flow: planned, run: managedRun("plan", "completed") },
      { flow: completedApply, run: managedRun("apply", "completed") },
    );

    expect(graph.entries[0]?.invalidated).toBe(true);
    expect(graph.activities.size).toBe(0);
  });

  test("plays active apply states over the planned graph", () => {
    const plan = taskFlow([task("resolve", "pending"), task("install", "pending")]);
    const active = taskFlow([task("resolve", "completed", "new-resolve"), task("install", "running")]);
    const graph = projectCacheGraph([], { flow: plan, run: managedRun("plan", "completed") }, { flow: active, run: managedRun("apply", "running") });

    expect(graph.entries).toHaveLength(2);
    expect(graph.activities.get(graph.entries[0]!.id)?.status).toBe("completed");
    expect(graph.activities.get(graph.entries[1]!.id)?.status).toBe("running");
  });

  test("keeps historical cache nodes that are owned by a workspace", () => {
    const historical = cacheEntry("old", "resolve");
    const current = cacheEntry("current", "resolve");
    const flow = taskFlow([task("resolve", "cached", "current")]);

    const graph = projectCacheGraph(
      [historical, current],
      { flow, run: managedRun("plan", "completed") },
      undefined,
      new Set(["old"]),
    );

    expect(graph.entries.map((entry) => entry.id)).toEqual(["current", "old"]);
    expect(graph.mainEntryIds).toEqual(new Set(["current"]));
  });

  test("does not label every retained workspace flow as main while the remote flow is unavailable", () => {
    const first = cacheEntry("first", "resolve");
    const second = cacheEntry("second", "verify");
    const graph = projectCacheGraph(
      [first, second],
      undefined,
      undefined,
      new Set(["first", "second"]),
    );

    expect(graph.entries.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(graph.mainEntryIds).toEqual(new Set());
  });

  test("keeps a checkout cache branch separate from the remote main flow", () => {
    const remote = cacheEntry("remote", "verify");
    const checkout = cacheEntry("checkout", "verify");
    const graph = projectCacheGraph(
      [remote, checkout],
      { flow: taskFlow([task("verify", "cached", "remote")]), run: managedRun("plan", "completed") },
      { flow: taskFlow([task("verify", "cached", "checkout")]), run: machineRun("apply", "running") },
      new Set(["checkout"]),
    );

    expect(graph.entries.map((entry) => entry.id)).toEqual(["remote", "checkout"]);
    expect(graph.mainEntryIds).toEqual(new Set(["remote"]));
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

function machineRun(operation: "plan" | "apply", status: "completed" | "running"): ManagedRun {
  return { ...managedRun(operation, status), origin: "machine" };
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
