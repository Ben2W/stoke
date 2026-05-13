import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, runtimeFingerprintFor, runtimePaths, SUPPORTED_RUNTIME_API_VERSION } from "@rigkit/runtime-client";
import { completeRig, formatCompletionItems, renderCompletionScript } from "./completion.ts";

describe("CLI completion", () => {
  test("completes ssh workspace targets from the runtime", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeRig({
        cwd: projectDir,
        words: ["rig", "ssh", ""],
        currentIndex: 2,
      });

      expect(items.map((item) => item.value)).toEqual(["api", "web"]);
      expect(items[0]?.description).toBe("vm-api");
    });
  });

  test("completes ssh resource ids when the current token starts like a resource id", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeRig({
        cwd: projectDir,
        words: ["rig", "ssh", "vm-"],
        currentIndex: 2,
      });

      expect(items.map((item) => item.value)).toEqual(["vm-api", "vm-web"]);
    });
  });

  test("respects -C when completing workspace targets", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "rigkit-completion-parent-"));
    const projectDir = join(parentDir, "project");
    await withWorkspaceRuntime({ projectDir, cleanupDir: parentDir }, async () => {
      const items = await completeRig({
        cwd: parentDir,
        words: ["rig", "-C", "project", "ssh", ""],
        currentIndex: 4,
      });

      expect(items.map((item) => item.value)).toEqual(["api", "web"]);
    });
  });

  test("completes workspace operation targets", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const roots = await completeRig({
        cwd: projectDir,
        words: ["rig", "run", ""],
        currentIndex: 2,
      });
      expect(roots.map((item) => item.value)).toContain("api/");
      expect(roots.map((item) => item.value)).toContain("ssh");

      const operations = await completeRig({
        cwd: projectDir,
        words: ["rig", "run", "api/"],
        currentIndex: 2,
      });
      expect(operations.map((item) => item.value)).toEqual(["api/remove", "api/open-cmux"]);
    });
  });

  test("formats shell completion items", () => {
    const items = [{ value: "api", description: "vm-api" }];

    expect(formatCompletionItems(items, "bash")).toBe("api");
    expect(formatCompletionItems(items, "zsh")).toBe("api\tvm-api");
    expect(renderCompletionScript("zsh")).toContain("rig __complete");
  });

  test("completes ls targets", async () => {
    const items = await completeRig({
      cwd: process.cwd(),
      words: ["rig", "ls", ""],
      currentIndex: 2,
    });

    expect(items.map((item) => item.value)).toEqual(["workspaces", "snapshots", "config", "--json"]);
  });
});

async function withWorkspaceRuntime(
  input: { projectDir: string; cleanupDir?: string },
  run: () => Promise<void>,
): Promise<void> {
  const previousHome = process.env.RIGKIT_HOME;
  const rigkitHome = mkdtempSync(join(tmpdir(), "rigkit-home-"));
  const token = "test-token";
  const configPath = join(input.projectDir, "rig.config.ts");
  mkdirSync(input.projectDir, { recursive: true });
  writeFileSync(configPath, "export default {}\n");
  const projectId = projectIdFor({ projectDir: input.projectDir, configPath });
  const runtimeFingerprint = runtimeFingerprintFor({ projectDir: input.projectDir, configPath });
  const paths = runtimePaths(projectId, rigkitHome);
  mkdirSync(paths.root, { recursive: true });
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
          runtimeFingerprint,
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
              resources: {},
              kv: {},
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
              resources: {},
              kv: {},
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
          workspaceOperations: [
            {
              id: "remove",
              kind: "workspace-action",
              source: "core",
              title: "Remove",
              description: "remove workspace",
              cli: {
                options: [{ name: "yes", flag: "--yes", aliases: ["-y"], type: "boolean", runtime: false }],
              },
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {},
              },
            },
            {
              id: "open-cmux",
              kind: "workspace-action",
              source: "config",
              title: "Open cmux",
              description: "open cmux",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {},
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
      runtimeFingerprint,
      projectDir: input.projectDir,
      configPath,
      pid: process.pid,
      url: `http://127.0.0.1:${server.port}`,
      tokenPath: paths.tokenPath,
    }, null, 2)}\n`,
  );

  process.env.RIGKIT_HOME = rigkitHome;
  try {
    await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.RIGKIT_HOME;
    } else {
      process.env.RIGKIT_HOME = previousHome;
    }
    server.stop(true);
    rmSync(rigkitHome, { recursive: true, force: true });
    rmSync(input.cleanupDir ?? input.projectDir, { recursive: true, force: true });
  }
}

function runtimeJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("x-rigkit-api-version", String(SUPPORTED_RUNTIME_API_VERSION));
  return Response.json(body, { ...init, headers });
}
