import { describe, expect, test } from "bun:test";
import type { ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { unmatchedActiveRemovals, workspaceRemovalFor } from "./workspace-removals.ts";

const workspace = {
  id: "workspace-1",
  projectId: "00000000-0000-4000-8000-000000000002",
  name: "calm-anchor",
  workflow: "example",
  ctx: {},
  operations: [],
  createdFrom: { kind: "dashboard" },
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:10:00.000Z",
} satisfies ManagedWorkspace;

const removal = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  origin: "dashboard",
  operation: "remove",
  workflow: "example",
  workspace: workspace.name,
  fingerprint: "remote:remove",
  status: "running",
  startedAt: "2026-08-05T10:05:00.000Z",
  updatedAt: "2026-08-05T10:05:00.000Z",
} satisfies ManagedRun;

describe("workspace removal presentation", () => {
  test("matches a removal started after creation even when workspace state was updated later", () => {
    expect(workspaceRemovalFor([removal], workspace)?.id).toBe(removal.id);
  });

  test("keeps a removal placeholder when the workspace query briefly omits the card", () => {
    expect(unmatchedActiveRemovals([removal], [])).toEqual([removal]);
    expect(unmatchedActiveRemovals([removal], [workspace])).toEqual([]);
  });
});
