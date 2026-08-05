import { describe, expect, test } from "bun:test";
import { cacheOwnershipLabel, groupCacheOwnership } from "./cache-ownership.ts";

describe("cache ownership", () => {
  test("combines main and workspaces that share the same cache flow", () => {
    const groups = groupCacheOwnership(new Set(["node-a", "node-b"]), [
      { id: "workspace-1", name: "snowy-orbit", sourceRevision: "fd097b4", cacheEntryIds: ["node-b", "node-a"], createdFrom: { kind: "dashboard" } },
      { id: "workspace-2", name: "quiet-summit", sourceRevision: "23a91cd", cacheEntryIds: ["node-a", "node-b"], createdFrom: { kind: "dashboard" } },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.main).toBe(true);
    expect(groups[0]?.workspaces.map((workspace) => workspace.name)).toEqual(["quiet-summit", "snowy-orbit"]);
    expect(cacheOwnershipLabel(groups[0]!)).toBe("remote main · 2 workspaces");
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
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(cacheOwnershipLabel)).toEqual(["remote main", "Ben's MacBook · 1 workspace"]);
  });
});
