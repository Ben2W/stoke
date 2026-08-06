import { describe, expect, test } from "bun:test";
import type { ManagedCacheEntry } from "@usestoke/managed";
import {
  cacheOwnershipLabel,
  cacheOwnershipOriginLabel,
  groupCacheOwnership,
  workflowVersionFingerprint,
  workspaceMatchesWorkflowVersion,
} from "./cache-ownership.ts";

describe("cache ownership", () => {
  test("detects whether a workspace uses the remote workflow cache version", () => {
    expect(workspaceMatchesWorkflowVersion(["node-a", "node-b"], new Set(["node-b", "node-a"]))).toBe(true);
    expect(workspaceMatchesWorkflowVersion(["node-a", "node-local"], new Set(["node-a", "node-main"]))).toBe(false);
    expect(workspaceMatchesWorkflowVersion(undefined, new Set(["node-a"]))).toBeUndefined();
    expect(workspaceMatchesWorkflowVersion(["node-a"], new Set())).toBeUndefined();
  });

  test("combines main and workspaces that share the same cache flow", () => {
    const entries = [cacheEntry("node-a", "clone", "cache:aaa"), cacheEntry("node-b", "test", "cache:bbb", ["node-a"])];
    const groups = groupCacheOwnership(new Set(["node-a", "node-b"]), [
      { id: "workspace-1", name: "snowy-orbit", sourceRevision: "fd097b4", cacheEntryIds: ["node-b", "node-a"], createdFrom: { kind: "dashboard" } },
      { id: "workspace-2", name: "quiet-summit", sourceRevision: "23a91cd", cacheEntryIds: ["node-a", "node-b"], createdFrom: { kind: "dashboard" } },
    ], entries);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.main).toBe(true);
    expect(groups[0]?.workspaces.map((workspace) => workspace.name)).toEqual(["quiet-summit", "snowy-orbit"]);
    expect(cacheOwnershipLabel(groups[0]!)).toBe("Main · 2 workspaces");
    expect(cacheOwnershipOriginLabel(groups[0]!)).toBe("Main");
    expect(groups[0]?.fingerprint).toBe(workflowVersionFingerprint(new Set(["node-a", "node-b"]), entries));
  });

  test("keeps a historical workspace flow separate from main", () => {
    const groups = groupCacheOwnership(new Set(["main-node"]), [
      {
        id: "workspace-1",
        name: "old-workspace",
        sourceRevision: "abc1234",
        cacheEntryIds: ["old-node"],
        createdFrom: {
          kind: "checkout",
          deviceId: "device-1",
          deviceName: "Ben's MacBook",
          checkoutId: "00000000-0000-4000-8000-000000000001",
          checkoutPath: "/repo",
        },
      },
    ], [cacheEntry("main-node", "verify", "cache:main"), cacheEntry("old-node", "verify", "cache:old")]);

    expect(groups).toHaveLength(2);
    expect(groups.map(cacheOwnershipLabel)).toEqual(["Main", "Checkpoint abc1234 · 1 workspace"]);
    expect(groups.map(cacheOwnershipOriginLabel)).toEqual(["Main", "Checkpoint abc1234"]);
    expect(groups[0]?.fingerprint).not.toBe(groups[1]?.fingerprint);
  });

  test("keeps a workflow version fingerprint stable across cache entry ordering", () => {
    const entries = [cacheEntry("node-a", "clone", "cache:aaa"), cacheEntry("node-b", "test", "cache:bbb", ["node-a"])];
    expect(workflowVersionFingerprint(new Set(["node-a", "node-b"]), entries)).toBe(
      workflowVersionFingerprint(new Set(["node-b", "node-a"]), [...entries].reverse()),
    );
    expect(workflowVersionFingerprint(new Set(["node-a"]), entries)).not.toBe(
      workflowVersionFingerprint(new Set(["node-a", "node-b"]), entries),
    );
  });
});

function cacheEntry(id: string, nodePath: string, fingerprint: string, upstreamRunIds: string[] = []): ManagedCacheEntry {
  return {
    id,
    scope: "project",
    workflow: "web",
    nodePath,
    nodeName: nodePath,
    nodeKind: "task",
    fingerprint,
    upstreamRunIds,
    invalidated: false,
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}
