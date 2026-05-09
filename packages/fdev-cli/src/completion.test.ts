import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, runtimePaths } from "@freestyle-sh/fdev-runtime-client";
import { completeFdev, formatCompletionItems, renderCompletionScript } from "./completion.ts";

describe("CLI completion", () => {
  test("completes ssh workspace targets from the runtime", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeFdev({
        cwd: projectDir,
        words: ["fdev", "ssh", ""],
        currentIndex: 2,
      });

      expect(items.map((item) => item.value)).toEqual(["api", "web"]);
      expect(items[0]?.description).toBe("vm-api");
    });
  });

  test("completes ssh resource ids when the current token starts like a resource id", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeFdev({
        cwd: projectDir,
        words: ["fdev", "ssh", "vm-"],
        currentIndex: 2,
      });

      expect(items.map((item) => item.value)).toEqual(["vm-api", "vm-web"]);
    });
  });

  test("respects -C when completing workspace targets", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "fdev-completion-parent-"));
    const projectDir = join(parentDir, "project");
    await withWorkspaceRuntime({ projectDir, cleanupDir: parentDir }, async () => {
      const items = await completeFdev({
        cwd: parentDir,
        words: ["fdev", "-C", "project", "ssh", ""],
        currentIndex: 4,
      });

      expect(items.map((item) => item.value)).toEqual(["api", "web"]);
    });
  });

  test("formats shell completion items", () => {
    const items = [{ value: "api", description: "vm-api" }];

    expect(formatCompletionItems(items, "bash")).toBe("api");
    expect(formatCompletionItems(items, "zsh")).toBe("api\tvm-api");
    expect(renderCompletionScript("zsh")).toContain("fdev __complete");
  });
});

async function withWorkspaceRuntime(
  input: { projectDir: string; cleanupDir?: string },
  run: () => Promise<void>,
): Promise<void> {
  const previousHome = process.env.FDEV_HOME;
  const fdevHome = mkdtempSync(join(tmpdir(), "fdev-home-"));
  const token = "test-token";
  const configPath = join(input.projectDir, "fdev.config.ts");
  const projectId = projectIdFor({ projectDir: input.projectDir, configPath });
  const paths = runtimePaths(projectId, fdevHome);
  mkdirSync(input.projectDir, { recursive: true });
  mkdirSync(paths.root, { recursive: true });
  writeFileSync(configPath, "export default {}\n");
  writeFileSync(paths.tokenPath, `${token}\n`);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
      }

      const { pathname } = new URL(request.url);
      if (pathname === "/health") {
        return Response.json({ ok: true, projectId });
      }
      if (pathname === "/workspaces") {
        return Response.json({
          workspaces: [
            { name: "api", resourceId: "vm-api" },
            { name: "web", resourceId: "vm-web" },
          ],
        });
      }
      return Response.json({ error: { message: "Not found" } }, { status: 404 });
    },
  });

  writeFileSync(
    paths.handlePath,
    `${JSON.stringify({
      projectId,
      projectDir: input.projectDir,
      configPath,
      pid: process.pid,
      url: `http://127.0.0.1:${server.port}`,
      tokenPath: paths.tokenPath,
    }, null, 2)}\n`,
  );

  process.env.FDEV_HOME = fdevHome;
  try {
    await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.FDEV_HOME;
    } else {
      process.env.FDEV_HOME = previousHome;
    }
    server.stop(true);
    rmSync(fdevHome, { recursive: true, force: true });
    rmSync(input.cleanupDir ?? input.projectDir, { recursive: true, force: true });
  }
}
