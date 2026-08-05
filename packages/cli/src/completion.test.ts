import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, runtimeFingerprintFor, runtimePaths, SUPPORTED_RUNTIME_API_VERSION } from "@rigkit/runtime-client";
import { completeRig, formatCompletionItems, formatWorkspaceAge, renderCompletionScript } from "./completion.ts";

function rigkitIndexPath(projectDir: string): string {
  return join(projectDir, "rigkit", "index.ts");
}

function writeRigkitIndex(projectDir: string): string {
  const configPath = rigkitIndexPath(projectDir);
  mkdirSync(join(projectDir, "rigkit"), { recursive: true });
  writeFileSync(configPath, "export const dev = {}\n");
  return configPath;
}

describe("CLI completion", () => {
  test("completes workspace targets from the runtime", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", ""],
        currentIndex: 2,
      });

      expect(items.map((item) => item.value)).toEqual(["api", "web", "--workflow", "--json", "--help"]);
      expect(items[0]?.description).toBe("created 2h ago");
    });
  });

  test("does not complete provider resource ids as workspace targets", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "vm-"],
        currentIndex: 2,
      });

      expect(items).toEqual([]);
    });
  });

  test("respects --chdir when completing workspace targets", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "rigkit-completion-parent-"));
    const projectDir = join(parentDir, "project");
    await withWorkspaceRuntime({ projectDir, cleanupDir: parentDir }, async () => {
      const items = await completeRig({
        cwd: parentDir,
        words: ["stoke", "--chdir=project", "run", ""],
        currentIndex: 3,
      });

      expect(items.map((item) => item.value)).toEqual(["api", "web", "--workflow", "--json", "--help"]);
    });
  });

  test("completes project directories for --chdir", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-completion-dirs-"));
    mkdirSync(join(cwd, "examples", "global-fragments"), { recursive: true });

    try {
      const roots = await completeRig({
        cwd,
        words: ["stoke", "--chdir="],
        currentIndex: 1,
      });

      expect(roots).toContainEqual({
        value: "--chdir=examples/",
        description: "directory",
        noSpace: true,
        group: "Paths",
      });

      const nested = await completeRig({
        cwd,
        words: ["stoke", "--chdir=examples/g"],
        currentIndex: 1,
      });

      expect(nested).toContainEqual({
        value: "--chdir=examples/global-fragments/",
        description: "directory",
        noSpace: true,
        group: "Paths",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("suggests conventional double-dash global flags by default", async () => {
    const items = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "--"],
      currentIndex: 1,
    });

    expect(items.map((item) => item.value)).toEqual([
      "--chdir=",
      "--state=",
      "--project=",
      "--json",
      "--help",
      "--version",
    ]);
  });

  test("completes project directories for --chdir", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-completion-dirs-"));
    mkdirSync(join(cwd, "examples", "global-fragments"), { recursive: true });

    try {
      const roots = await completeRig({
        cwd,
        words: ["stoke", "--chdir="],
        currentIndex: 1,
      });

      expect(roots).toContainEqual({
        value: "--chdir=examples/",
        description: "directory",
        noSpace: true,
        group: "Paths",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("completes workspace operation targets", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const roots = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", ""],
        currentIndex: 2,
      });
      expect(roots.map((item) => item.value)).toEqual(["api", "web", "--workflow", "--json", "--help"]);
      expect(roots[0]).toMatchObject({ description: "created 2h ago" });

      const exactWorkspace = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "api"],
        currentIndex: 2,
      });
      expect(exactWorkspace.map((item) => item.value)).toEqual(["api"]);

      const workspaceAfterSpace = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "api", ""],
        currentIndex: 3,
      });
      expect(workspaceAfterSpace.map((item) => item.value)).toEqual(["remove", "open-cmux", "--workflow", "--json", "--help"]);

      const operationPrefix = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "api", "open"],
        currentIndex: 3,
      });
      expect(operationPrefix.map((item) => item.value)).toEqual(["open-cmux"]);
    });
  });

  test("completes rm workspace targets and confirmation flags", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const workspaces = await completeRig({
        cwd: projectDir,
        words: ["stoke", "rm", ""],
        currentIndex: 2,
      });
      expect(workspaces.map((item) => item.value)).toEqual(["api", "web", "-y", "--yes", "--all", "--workflow", "--json", "--help"]);

      const flags = await completeRig({
        cwd: projectDir,
        words: ["stoke", "rm", "api", "-"],
        currentIndex: 3,
      });
      expect(flags.map((item) => item.value)).toContain("-y");
      expect(flags.map((item) => item.value)).toContain("--yes");
    });
  });

  test("uses --workflow to scope workspace command completion", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir, includeApiWorkflow: true }, async () => {
      const workflowValues = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "--workflow", ""],
        currentIndex: 3,
      });
      expect(workflowValues.map((item) => item.value)).toEqual(["smoke", "api"]);

      const workspaces = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "--workflow", "api", ""],
        currentIndex: 4,
      });
      expect(workspaces.map((item) => item.value)).toEqual(["worker", "--workflow", "--json", "--help"]);

      const operations = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "--workflow", "api", "worker", ""],
        currentIndex: 5,
      });
      expect(operations.map((item) => item.value)).toEqual(["remove", "tail-logs", "logs", "--workflow", "--json", "--help"]);

      const operationFlags = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "--workflow", "api", "worker", "tail-logs", "--"],
        currentIndex: 6,
      });
      expect(operationFlags.map((item) => item.value)).toEqual(["--service", "--workflow", "--json", "--help"]);

      const removeTargets = await completeRig({
        cwd: projectDir,
        words: ["stoke", "rm", "--workflow=api", ""],
        currentIndex: 3,
      });
      expect(removeTargets.map((item) => item.value)).toEqual(["worker", "-y", "--yes", "--all", "--workflow", "--json", "--help"]);
    });
  });

  test("completes top-level project commands at the root command position", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const items = await completeRig({
        cwd: projectDir,
        words: ["stoke", "p"],
        currentIndex: 1,
      });

      expect(items.map((item) => item.value)).toEqual(["project", "plan", "providers"]);
    });
  });

  test("completes cache at the root command position after global options", async () => {
    const items = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "--chdir=.", "c"],
      currentIndex: 2,
    });

    expect(items.map((item) => item.value)).toEqual(["create", "cache", "completion"]);
  });

  test("completes cache subcommands and flags", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const workflows = await completeRig({
        cwd: projectDir,
        words: ["stoke", "cache", ""],
        currentIndex: 2,
      });

      expect(workflows.map((item) => item.value)).toEqual(["smoke", "api"]);

      const subcommands = await completeRig({
        cwd: projectDir,
        words: ["stoke", "cache", "smoke", ""],
        currentIndex: 3,
      });

      expect(subcommands.map((item) => item.value)).toEqual(["ls", "explain", "clear", "invalidate"]);

      const clearFlags = await completeRig({
        cwd: projectDir,
        words: ["stoke", "cache", "smoke", "clear", "--"],
        currentIndex: 4,
      });

      expect(clearFlags.map((item) => item.value)).toEqual([
        "--local",
        "--global",
        "--json",
        "--help",
      ]);
    });
  });

  test("completes provider targets, subcommands, and flags", async () => {
    const targets = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "providers", ""],
      currentIndex: 2,
    });

    expect(targets.map((item) => item.value)).toEqual(["freestyle"]);

    const targetFlags = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "providers", "--"],
      currentIndex: 2,
    });

    expect(targetFlags.map((item) => item.value)).toEqual(["--help"]);

    const subcommands = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "providers", "freestyle", ""],
      currentIndex: 3,
    });

    expect(subcommands.map((item) => item.value)).toEqual(["clear"]);

    const clearFlags = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "providers", "freestyle", "clear", "--"],
      currentIndex: 4,
    });

    expect(clearFlags.map((item) => item.value)).toEqual(["--json", "--help"]);
  });

  test("completes project operation flags and workflow values", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const flags = await completeRig({
        cwd: projectDir,
        words: ["stoke", "apply", "--"],
        currentIndex: 2,
      });

      expect(flags.map((item) => item.value)).toEqual([
        "--workflow",
        "--dry-run",
        "--all",
        "--discover",
        "--json",
        "--help",
      ]);

      const workflowValues = await completeRig({
        cwd: projectDir,
        words: ["stoke", "apply", "--workflow", ""],
        currentIndex: 3,
      });
      expect(workflowValues.map((item) => item.value)).toEqual(["smoke", "api"]);

      const inlineWorkflow = await completeRig({
        cwd: projectDir,
        words: ["stoke", "apply", "--workflow=s"],
        currentIndex: 2,
      });
      expect(inlineWorkflow.map((item) => item.value)).toEqual(["--workflow=smoke"]);
    });
  });

  test("completes workspace operation flags and enum values", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const flags = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "api", "open-cmux", "--"],
        currentIndex: 4,
      });

      expect(flags.map((item) => item.value)).toEqual(["--layout", "--workflow", "--json", "--help"]);

      const values = await completeRig({
        cwd: projectDir,
        words: ["stoke", "run", "api", "open-cmux", "--layout", ""],
        currentIndex: 5,
      });
      expect(values.map((item) => item.value)).toEqual(["tabs", "splits"]);
    });
  });

  test("completes cache invalidate targets and flags", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir }, async () => {
      const targets = await completeRig({
        cwd: projectDir,
        words: ["stoke", "cache", "smoke", "invalidate", ""],
        currentIndex: 4,
      });

      expect(targets.map((item) => item.value)).toEqual([
        "install-tooling",
        "setup.build",
        "base",
        "--all",
        "-y",
        "--yes",
        "--json",
        "--help",
      ]);

      const flags = await completeRig({
        cwd: projectDir,
        words: ["stoke", "cache", "smoke", "invalidate", "--"],
        currentIndex: 4,
      });
      expect(flags.map((item) => item.value)).toEqual(["--all", "--yes", "--json", "--help"]);

      const explainTargets = await completeRig({
        cwd: projectDir,
        words: ["stoke", "cache", "smoke", "explain", ""],
        currentIndex: 4,
      });
      expect(explainTargets.map((item) => item.value)).toEqual(["install-tooling", "setup.build", "base", "--json", "--help"]);
    });

    const apiProjectDir = mkdtempSync(join(tmpdir(), "rigkit-completion-"));
    await withWorkspaceRuntime({ projectDir: apiProjectDir, includeApiWorkflow: true }, async () => {
      const apiTargets = await completeRig({
        cwd: apiProjectDir,
        words: ["stoke", "cache", "api", "invalidate", ""],
        currentIndex: 4,
      });
      expect(apiTargets.map((item) => item.value)).toEqual(["api.ready", "--all", "-y", "--yes", "--json", "--help"]);
    });
  });

  test("completes static command flags and option values", async () => {
    const initFlags = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "init", "--"],
      currentIndex: 2,
    });
    expect(initFlags.map((item) => item.value)).toEqual(["--help"]);

    const doctorFlags = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "doctor", "--"],
      currentIndex: 2,
    });
    expect(doctorFlags.map((item) => item.value)).toEqual(["--cli", "--json", "--help"]);

    const useFlags = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "use", "--"],
      currentIndex: 2,
    });
    expect(useFlags.map((item) => item.value)).toEqual(["--clear", "--json", "--help"]);

    const projectSubcommands = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "project", ""],
      currentIndex: 2,
    });
    expect(projectSubcommands.map((item) => item.value)).toEqual(["remove"]);

    const projectRemoveFlags = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "project", "remove", "--"],
      currentIndex: 3,
    });
    expect(projectRemoveFlags.map((item) => item.value)).toEqual(["--yes", "--json", "--help"]);

    const completionShells = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "completion", ""],
      currentIndex: 2,
    });
    expect(completionShells.map((item) => item.value)).toEqual(["bash", "fish", "zsh", "--help"]);
  });

  test("formats shell completion items", () => {
    const items = [{ value: "api", description: "vm-api" }];

    expect(formatCompletionItems(items, "bash")).toBe("api");
    // zsh wire format is `value\tdescription\tmarker\tgroup`. Empty trailing
    // fields are kept so the shell-side parser can index positionally.
    expect(formatCompletionItems(items, "zsh")).toBe("api\tvm-api\t\t");
    expect(formatCompletionItems(
      [{ value: "api", description: "workspace smoke", noSpace: true, group: "Workspaces" }],
      "zsh",
    )).toBe("api\tworkspace smoke\tnospace\tWorkspaces");
    expect(renderCompletionScript("zsh")).toContain("stoke __complete");
    expect(renderCompletionScript("zsh")).toContain("_describe");
    expect(renderCompletionScript("zsh")).toContain(":completion:*:stoke:*:descriptions");
    expect(renderCompletionScript("zsh")).toContain("compdef _stoke stoke");
  });

  test("formats workspace ages", () => {
    const now = Date.parse("2026-05-14T12:00:00.000Z");

    expect(formatWorkspaceAge("2026-05-14T11:59:45.000Z", now)).toBe("just now");
    expect(formatWorkspaceAge("2026-05-14T11:30:00.000Z", now)).toBe("30m ago");
    expect(formatWorkspaceAge("2026-05-14T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatWorkspaceAge("2026-05-11T12:00:00.000Z", now)).toBe("3d ago");
    expect(formatWorkspaceAge("not-a-date", now)).toBeUndefined();
  });

  test("completes ls targets", async () => {
    const items = await completeRig({
      cwd: process.cwd(),
      words: ["stoke", "ls", ""],
      currentIndex: 2,
    });

    expect(items.map((item) => item.value)).toEqual(["--json", "--help"]);
  });
});

async function withWorkspaceRuntime(
  input: { projectDir: string; cleanupDir?: string; includeApiWorkflow?: boolean },
  run: () => Promise<void>,
): Promise<void> {
  const previousHome = process.env.RIGKIT_HOME;
  const rigkitHome = mkdtempSync(join(tmpdir(), "rigkit-home-"));
  const token = "test-token";
  mkdirSync(input.projectDir, { recursive: true });
  const configPath = writeRigkitIndex(input.projectDir);
  const projectId = projectIdFor({ projectDir: input.projectDir, configPath });
  const runtimeFingerprint = runtimeFingerprintFor({ projectDir: input.projectDir, configPath });
  const paths = runtimePaths(projectId, rigkitHome);
  mkdirSync(paths.root, { recursive: true });
  writeFileSync(paths.tokenPath, `${token}\n`);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
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
        const nowMs = Date.now();
        const apiCreatedAt = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
        const webCreatedAt = new Date(nowMs - 5 * 60 * 1000).toISOString();
        const workerCreatedAt = new Date(nowMs - 60 * 1000).toISOString();
        const updatedAt = new Date(nowMs).toISOString();
        return runtimeJson({
          workspaces: [
            {
              id: "workspace-api",
              name: "api",
              workflow: "smoke",
              ctx: {},
              createdAt: apiCreatedAt,
              updatedAt,
            },
            {
              id: "workspace-web",
              name: "web",
              workflow: "smoke",
              ctx: {},
              createdAt: webCreatedAt,
              updatedAt,
            },
            ...(input.includeApiWorkflow ? [{
              id: "workspace-worker",
              name: "worker",
              workflow: "api",
              ctx: {},
              createdAt: workerCreatedAt,
              updatedAt,
            }] : []),
          ],
        });
      }
      if (pathname === "/workflows") {
        return runtimeJson({
          workflows: [
            {
              name: "smoke",
              providers: [],
              nodes: ["install-tooling", "build"],
              operations: ["plan", "apply", "create"],
              createsWorkspace: true,
            },
            {
              name: "api",
              providers: [],
              nodes: ["install-tooling"],
              operations: ["plan", "apply"],
              createsWorkspace: Boolean(input.includeApiWorkflow),
            },
          ],
        });
      }
      if (pathname === "/cache" || pathname === "/cache/list" || pathname === "/cache/explain") {
        const nowMs = Date.now();
        const body = pathname === "/cache" ? {} : await request.json() as { workflow?: string };
        const entries = [
          {
            scope: "local",
            workflow: "smoke",
            nodePath: "install-tooling",
            nodeName: "install-tooling",
            nodeKind: "task",
            runId: "run-install",
            invalidated: false,
            createdAt: new Date(nowMs - 60_000).toISOString(),
          },
          {
            scope: "local",
            workflow: "smoke",
            nodePath: "build",
            displayPath: "setup.build",
            planIndex: 1,
            nodeName: "build",
            nodeKind: "task",
            runId: "run-build",
            invalidated: false,
            createdAt: new Date(nowMs - 30_000).toISOString(),
          },
          {
            scope: "local",
            workflow: "smoke",
            nodePath: "old-task",
            nodeName: "old-task",
            nodeKind: "task",
            runId: "run-old",
            invalidated: true,
            createdAt: new Date(nowMs - 10_000).toISOString(),
          },
          {
            scope: "global",
            workflow: "smoke",
            nodePath: "base",
            nodeName: "base",
            nodeKind: "task",
            runId: "run-base",
            invalidated: false,
            createdAt: new Date(nowMs - 5_000).toISOString(),
            fragmentHash: "fragment",
          },
          ...(input.includeApiWorkflow ? [{
            scope: "local",
            workflow: "api",
            nodePath: "ready",
            displayPath: "api.ready",
            planIndex: 0,
            nodeName: "ready",
            nodeKind: "task",
            runId: "run-api-ready",
            invalidated: false,
            createdAt: new Date(nowMs - 15_000).toISOString(),
          }] : []),
        ];
        const filtered = body.workflow ? entries.filter((entry) => entry.workflow === body.workflow) : entries;
        if (pathname === "/cache/explain") {
          return runtimeJson({
            workflow: body.workflow ?? "smoke",
            explanations: filtered
              .filter((entry) => !entry.invalidated)
              .map((entry) => ({
                workflow: entry.workflow,
                path: entry.displayPath ?? entry.nodePath,
                name: entry.nodeName,
                status: "cached",
                reason: { code: "cached", message: "cached" },
                runId: entry.runId,
                scope: entry.scope,
                cacheWorkflow: entry.workflow,
                cacheNodePath: entry.nodePath,
                upstreamRunIds: [],
                candidates: [{
                  runId: entry.runId,
                  scope: entry.scope,
                  nodePath: entry.nodePath,
                  displayPath: entry.displayPath ?? entry.nodePath,
                  nodeName: entry.nodeName,
                  nodeKind: entry.nodeKind,
                  createdAt: entry.createdAt,
                  invalidated: entry.invalidated,
                  reasons: [{ code: "cached", message: "cached" }],
                }],
              })),
          });
        }
        return runtimeJson({
          entries: filtered,
        });
      }
      if (pathname === "/operations") {
        return runtimeJson({
          operations: [
            {
              workflow: "smoke",
              id: "plan",
              kind: "command",
              source: "core",
              title: "Plan",
              description: "Show cached and pending steps",
              cli: {
                options: [{ name: "workflow", flag: "--workflow" }],
              },
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  workflow: { type: "string", enum: ["smoke", "api"] },
                },
              },
            },
            {
              workflow: "smoke",
              id: "apply",
              kind: "command",
              source: "core",
              title: "Apply",
              description: "Resolve the workflow",
              cli: {
                options: [
                  { name: "workflow", flag: "--workflow" },
                  { name: "dryRun", flag: "--dry-run", type: "boolean" },
                ],
              },
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  workflow: { type: "string", enum: ["smoke", "api"] },
                  dryRun: { type: "boolean" },
                },
              },
            },
            {
              workflow: "smoke",
              id: "create",
              kind: "command",
              source: "core",
              title: "Create",
              description: "Create a workspace",
              createsWorkspace: true,
              cli: {
                positionals: [{ name: "name", index: 0 }],
                options: [
                  { name: "workflow", flag: "--workflow" },
                  { name: "name", flag: "--name", required: true },
                ],
              },
              inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["name"],
                properties: {
                  workflow: { type: "string", enum: ["smoke", "api"] },
                  name: { type: "string" },
                },
              },
            },
            {
              workflow: "smoke",
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
              workflow: "smoke",
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
              workflow: "smoke",
              id: "open-cmux",
              kind: "workspace-action",
              source: "config",
              title: "Open cmux",
              description: "open cmux",
              cli: {
                options: [{ name: "layout", flag: "--layout", type: "string" }],
              },
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  layout: { type: "string", enum: ["tabs", "splits"] },
                },
              },
            },
            ...(input.includeApiWorkflow ? [
              {
                workflow: "api",
                id: "remove",
                kind: "workspace-action",
                source: "core",
                title: "Remove",
                description: "remove api workspace",
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
                workflow: "api",
                id: "tail-logs",
                aliases: ["logs"],
                kind: "workspace-action",
                source: "config",
                title: "Tail logs",
                description: "tail logs",
                cli: {
                  options: [{ name: "service", flag: "--service", type: "string" }],
                },
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    service: { type: "string" },
                  },
                },
              },
            ] : []),
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
