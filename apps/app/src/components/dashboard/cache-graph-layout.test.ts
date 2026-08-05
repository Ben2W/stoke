import { describe, expect, test } from "bun:test";
import type { ManagedCacheEntry } from "@stoke/managed";
import { cacheInvalidationIds, layoutCacheGraph } from "./cache-graph-layout.ts";

const entries: ManagedCacheEntry[] = [
  cacheEntry("build"),
  cacheEntry("test", ["build"]),
  cacheEntry("deploy", ["test"]),
  cacheEntry("docs"),
];

describe("cache graph", () => {
  test("computes the same downstream invalidation closure as the control plane", () => {
    expect([...cacheInvalidationIds(entries, "build")]).toEqual(["build", "test", "deploy"]);
    expect([...cacheInvalidationIds(entries, "test")]).toEqual(["test", "deploy"]);
    expect([...cacheInvalidationIds(entries, "missing")]).toEqual([]);
  });

  test("places dependencies above their consumers and connects the real run IDs", () => {
    const graph = layoutCacheGraph(entries);
    const positions = new Map(graph.nodes.map((node) => [node.entry.id, node]));
    expect(positions.get("build")!.y).toBeLessThan(positions.get("test")!.y);
    expect(positions.get("test")!.y).toBeLessThan(positions.get("deploy")!.y);
    expect(graph.edges.map((edge) => [edge.fromId, edge.toId])).toEqual([
      ["build", "test"],
      ["test", "deploy"],
    ]);
  });
});

function cacheEntry(id: string, upstreamRunIds: string[] = []): ManagedCacheEntry {
  return {
    id,
    scope: "project",
    workflow: "default",
    nodePath: id,
    nodeName: id[0]!.toUpperCase() + id.slice(1),
    nodeKind: "task",
    upstreamRunIds,
    invalidated: false,
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}
