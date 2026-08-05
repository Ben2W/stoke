import { describe, expect, test } from "bun:test";
import type { ManagedProjectStateSnapshot } from "@stoke/managed";
import {
  clearCacheSnapshot,
  invalidateCacheSnapshot,
  projectCacheEntries,
} from "./project-cache.ts";

describe("project cache", () => {
  test("projects only safe cache metadata", () => {
    const snapshot = cacheSnapshot();
    expect(projectCacheEntries(snapshot)).toEqual([
      {
        id: "deploy",
        scope: "project",
        workflow: "default",
        nodePath: "deploy",
        nodeName: "Deploy",
        nodeKind: "task",
        upstreamRunIds: ["build"],
        invalidated: false,
        createdAt: "2026-08-04T00:01:00.000Z",
      },
      {
        id: "build",
        scope: "project",
        workflow: "default",
        nodePath: "build",
        nodeName: "Build",
        nodeKind: "task",
        upstreamRunIds: [],
        invalidated: false,
        createdAt: "2026-08-04T00:00:00.000Z",
      },
    ]);
  });

  test("invalidates a target and all dependent results", () => {
    const snapshot = cacheSnapshot();
    expect(invalidateCacheSnapshot(snapshot, { scope: "project", entryId: "build" })).toBe(2);
    expect(snapshot.scopes.project?.nodeRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "build", invalidated: true }),
      expect.objectContaining({ id: "deploy", invalidated: true }),
    ]));
  });

  test("invalidates dependents in other cache scopes", () => {
    const snapshot = cacheSnapshot();
    snapshot.scopes.global = {
      workspaces: [],
      workflowApplies: [],
      providerState: [],
      nodeRuns: [{ ...nodeRun("base"), nodePath: "base", nodeName: "Base" }],
    };
    snapshot.scopes.project!.nodeRuns[0] = {
      ...snapshot.scopes.project!.nodeRuns[0] as Record<string, unknown>,
      upstreamRunIds: ["base"],
    };

    expect(invalidateCacheSnapshot(snapshot, { scope: "global", entryId: "base" })).toBe(3);
    expect(snapshot.scopes.global.nodeRuns[0]).toMatchObject({ id: "base", invalidated: true });
    expect(snapshot.scopes.project!.nodeRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "build", invalidated: true }),
      expect.objectContaining({ id: "deploy", invalidated: true }),
    ]));
  });

  test("clears every cache scope", () => {
    const snapshot = cacheSnapshot();
    snapshot.scopes.global = { workspaces: [], workflowApplies: [], providerState: [], nodeRuns: [{ ...nodeRun("global"), id: "global" }] };
    expect(clearCacheSnapshot(snapshot)).toBe(3);
    expect(Object.values(snapshot.scopes).every((scope) => scope.nodeRuns.length === 0)).toBe(true);
  });
});

function cacheSnapshot(): ManagedProjectStateSnapshot {
  return {
    version: 1,
    scopes: {
      project: {
        workspaces: [],
        workflowApplies: [],
        providerState: [],
        nodeRuns: [
          nodeRun("build"),
          { ...nodeRun("deploy"), upstreamRunIds: ["build"], createdAt: "2026-08-04T00:01:00.000Z" },
        ],
      },
    },
  };
}

function nodeRun(id: string) {
  return {
    id,
    workflow: "default",
    nodePath: id,
    nodeName: id[0]!.toUpperCase() + id.slice(1),
    nodeKind: "task",
    nodeKey: `${id}-key`,
    providerFingerprint: "provider",
    upstreamRunIds: [] as string[],
    output: { secretResult: "not exposed" },
    artifacts: [],
    invalidated: false,
    createdAt: "2026-08-04T00:00:00.000Z",
    metadata: {},
  };
}
