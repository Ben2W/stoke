import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeFdev, formatCompletionItems, renderCompletionScript } from "./completion.ts";

describe("CLI completion", () => {
  test("completes ssh workspace targets from local state", () => {
    const projectDir = projectWithWorkspaces();
    const items = completeFdev({
      cwd: projectDir,
      words: ["fdev", "ssh", ""],
      currentIndex: 2,
    });

    expect(items.map((item) => item.value)).toEqual(["api", "web"]);
    expect(items[0]?.description).toBe("vm-api");
  });

  test("completes ssh VM ids when the current token starts like a VM id", () => {
    const projectDir = projectWithWorkspaces();
    const items = completeFdev({
      cwd: projectDir,
      words: ["fdev", "ssh", "vm-"],
      currentIndex: 2,
    });

    expect(items.map((item) => item.value)).toEqual(["vm-api", "vm-web"]);
  });

  test("respects -C when completing workspace targets", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "fdev-completion-parent-"));
    const projectDir = join(parentDir, "project");
    writeState(projectDir);

    const items = completeFdev({
      cwd: parentDir,
      words: ["fdev", "-C", "project", "ssh", ""],
      currentIndex: 4,
    });

    expect(items.map((item) => item.value)).toEqual(["api", "web"]);
  });

  test("formats shell completion items", () => {
    const items = [{ value: "api", description: "vm-api" }];

    expect(formatCompletionItems(items, "bash")).toBe("api");
    expect(formatCompletionItems(items, "zsh")).toBe("api\tvm-api");
    expect(renderCompletionScript("zsh")).toContain("fdev __complete");
  });
});

function projectWithWorkspaces(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "fdev-completion-"));
  writeState(projectDir);
  return projectDir;
}

function writeState(projectDir: string): void {
  const stateDir = join(projectDir, ".fdev");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "state.json"),
    `${JSON.stringify({
      version: 1,
      snapshots: [],
      workspaces: {
        web: {
          name: "web",
          vmId: "vm-web",
          machine: "test",
          snapshotId: "snap-web",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        api: {
          name: "api",
          vmId: "vm-api",
          machine: "test",
          snapshotId: "snap-api",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }, null, 2)}\n`,
  );
}
