import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
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
  const db = new Database(join(stateDir, "state.sqlite"), { create: true });
  db.run(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      vm_id TEXT NOT NULL,
      machine TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `);
  const insert = db.query(`
    INSERT INTO workspaces (
      id,
      name,
      provider_id,
      vm_id,
      machine,
      snapshot_id,
      created_at,
      updated_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("workspace-web", "web", "freestyle", "vm-web", "test", "snap-web", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "{}");
  insert.run("workspace-api", "api", "freestyle", "vm-api", "test", "snap-api", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "{}");
  db.close();
}
