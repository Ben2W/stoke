import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeState } from "./managed-state.ts";

describe("managed runtime state", () => {
  test("round-trips a transient snapshot without changing its managed revision", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stoke-state-"));
    const path = join(directory, "state.json");
    writeFileSync(path, JSON.stringify({
      revision: 7,
      snapshot: { version: 1, scopes: {} },
    }));

    try {
      const state = await loadRuntimeState({ stateFile: path });
      state.project.saveNodeRun({
        id: "run-1",
        workflow: "default",
        nodePath: "install",
        nodeName: "install",
        nodeKind: "task",
        nodeKey: "key-1",
        providerFingerprint: "providers-1",
        upstreamRunIds: [],
        output: {},
        artifacts: [],
        invalidated: false,
        createdAt: "2026-08-04T00:00:00.000Z",
        metadata: {},
      });
      await state.persist();

      const saved = JSON.parse(readFileSync(path, "utf8"));
      expect(saved.revision).toBe(7);
      expect(saved.snapshot.scopes.project.nodeRuns).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects corrupt transferred state instead of replacing it with an empty snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stoke-state-corrupt-"));
    const path = join(directory, "state.json");
    writeFileSync(path, "not json");

    try {
      await expect(loadRuntimeState({ stateFile: path })).rejects.toThrow(
        "Could not read Stoke workflow state",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
