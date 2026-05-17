import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunLogger } from "./run-logger.ts";

describe("createRunLogger", () => {
  test("writes a run.start envelope, every appended event, and a run.end envelope", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-run-logger-"));
    try {
      const logger = createRunLogger({ projectDir, operation: "plan" });
      expect(logger).toBeDefined();
      logger!.append({ type: "node.started", nodePath: "build" });
      logger!.append({ type: "node.completed", nodePath: "build" });
      logger!.finish({ status: "completed", result: { ok: true } });
      logger!.close();

      const lines = readFileSync(logger!.path, "utf8").trim().split("\n");
      expect(lines.length).toBe(4);
      const entries = lines.map((line) => JSON.parse(line));
      expect(entries[0]).toMatchObject({ type: "run.start", operation: "plan" });
      expect(entries[1]).toMatchObject({ type: "node.started", nodePath: "build" });
      expect(entries[2]).toMatchObject({ type: "node.completed", nodePath: "build" });
      expect(entries[3]).toMatchObject({ type: "run.end", status: "completed", result: { ok: true } });

      const logFiles = readdirSync(join(projectDir, ".rigkit", "logs"));
      expect(logFiles.length).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("captures failure details on the run.end envelope", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-run-logger-"));
    try {
      const logger = createRunLogger({ projectDir, operation: "apply" });
      logger!.append({ type: "run.failed", error: { message: "boom" } });
      logger!.finish({ status: "failed", error: new Error("boom") });
      logger!.close();

      const entries = readFileSync(logger!.path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(entries.at(-1)).toMatchObject({
        type: "run.end",
        status: "failed",
        error: { message: "boom" },
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("splices daemon stderr written during the run into the failure log", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-run-logger-"));
    const daemonStderrPath = join(projectDir, "daemon.log");
    // Pre-existing daemon output that predates the run — we must NOT splice it.
    writeFileSync(daemonStderrPath, "earlier daemon noise we should ignore\n");

    try {
      const logger = createRunLogger({ projectDir, operation: "apply", daemonStderrPath });
      // Daemon writes a real stack trace mid-run.
      appendFileSync(daemonStderrPath, "Error: connect ECONNREFUSED 127.0.0.1:443\n    at fetch (engine.ts:42)\n");
      logger!.finish({ status: "failed", error: new Error("INTERNAL_ERROR: Internal server error") });
      logger!.close();

      const entries = readFileSync(logger!.path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const stderr = entries.filter((entry) => entry.type === "daemon.stderr").map((entry) => entry.data);
      expect(stderr).toEqual([
        "Error: connect ECONNREFUSED 127.0.0.1:443",
        "    at fetch (engine.ts:42)",
      ]);
      expect(stderr.some((line) => line.includes("earlier daemon noise"))).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("does not splice daemon stderr on success", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-run-logger-"));
    const daemonStderrPath = join(projectDir, "daemon.log");
    try {
      const logger = createRunLogger({ projectDir, operation: "apply", daemonStderrPath });
      appendFileSync(daemonStderrPath, "noise during a successful run\n");
      logger!.finish({ status: "completed" });
      logger!.close();

      const entries = readFileSync(logger!.path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(entries.find((entry) => entry.type === "daemon.stderr")).toBeUndefined();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
