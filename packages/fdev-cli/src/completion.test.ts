import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, runtimePaths, SUPPORTED_RUNTIME_API_VERSION } from "@freestyle-sh/fdev-runtime-client";
import { completeFdev, formatCompletionItems, renderCompletionScript } from "./completion.ts";

describe("CLI completion", () => {
  test("completes ssh workspace targets from the runtime", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeFdev({
        cwd: projectDir,
        words: ["fdev", "run", "ssh", ""],
        currentIndex: 3,
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
        words: ["fdev", "run", "ssh", "vm-"],
        currentIndex: 3,
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
        words: ["fdev", "-C", "project", "run", "ssh", ""],
        currentIndex: 5,
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
        return runtimeJson({ error: { message: "Unauthorized" } }, { status: 401 });
      }

      const { pathname } = new URL(request.url);
      if (pathname === "/health") {
        return runtimeJson({
          ok: true,
          projectId,
          projectDir: input.projectDir,
          configPath,
          engineVersion: "engine-test",
          runtimeVersion: "runtime-test",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      if (pathname === "/workspaces") {
        const now = new Date(0).toISOString();
        return runtimeJson({
          workspaces: [
            {
              id: "workspace-api",
              name: "api",
              providerId: "freestyle",
              workflow: "smoke",
              resourceId: "vm-api",
              sourceRef: null,
              context: {},
              metadata: {},
              data: {},
              createdAt: now,
              updatedAt: now,
            },
            {
              id: "workspace-web",
              name: "web",
              providerId: "freestyle",
              workflow: "smoke",
              resourceId: "vm-web",
              sourceRef: null,
              context: {},
              metadata: {},
              data: {},
              createdAt: now,
              updatedAt: now,
            },
          ],
        });
      }
      if (pathname === "/operations") {
        return runtimeJson({
          hostMethods: {
            known: [],
            requiredByOperations: {},
          },
          hostCapabilities: {
            optional: [],
            requiredByOperations: {},
          },
          operations: [
            {
              id: "ssh",
              kind: "command",
              source: "core",
              title: "SSH",
              description: "open SSH",
              cli: {
                positionals: [{ name: "workspaceOrVmId", index: 0 }],
                options: [{ name: "print", flag: "--print", type: "boolean", runtime: false }],
              },
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  workspaceOrVmId: { type: "string" },
                },
              },
            },
          ],
        });
      }
      return runtimeJson({ error: { message: "Not found" } }, { status: 404 });
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

function runtimeJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("x-fdev-api-version", String(SUPPORTED_RUNTIME_API_VERSION));
  return Response.json(body, { ...init, headers });
}
