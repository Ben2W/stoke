import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, runtimePaths, SUPPORTED_RUNTIME_API_VERSION } from "@freestyle-sh/fdev-runtime-client";
import { FDEV_CLI_VERSION } from "./version.ts";

const cliPath = join(import.meta.dir, "cli.ts");

describe("CLI entrypoint", () => {
  test("renders CLI diagnostics as JSON", async () => {
    const result = await runCli(["doctor", "--cli", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      cliVersion: FDEV_CLI_VERSION,
    });
  });

  test("exposes static help and version bootstrap commands", async () => {
    const rootHelp = await runCli([]);
    expect(rootHelp.exitCode).toBe(0);
    expect(rootHelp.stderr).toBe("");
    expect(rootHelp.stdout).toContain("fdev");
    expect(rootHelp.stdout).toContain("run         Run a project operation exposed by the runtime");

    const version = await runCli(["version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout.trim()).toBe(FDEV_CLI_VERSION);

    const help = await runCli(["help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("fdev");
    expect(help.stdout).toContain("run         Run a project operation exposed by the runtime");
  });

  test("reports unknown commands through Commander", async () => {
    const result = await runCli(["unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown command 'unknown'");
  });

  test("serves dynamic shell completion endpoint", async () => {
    const result = await runCli(["__complete", "--shell", "zsh", "--index", "1", "--", "fdev", "v"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("version\tshow CLI version");
  });

  test("discovers projects without starting a runtime", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-projects-"));
    mkdirSync(join(cwd, "api"));
    writeFileSync(join(cwd, "api", "fdev.config.ts"), "export default {}\n");

    try {
      const result = await runCli(["projects", "--json"], { cwd });
      const realCwd = realpathSync(cwd);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        projects: [{
          projectDir: join(realCwd, "api"),
          configPath: join(realCwd, "api", "fdev.config.ts"),
        }],
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("lists workspaces from the project runtime", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-cli-ls-"));

    await withWorkspaceRuntime({ projectDir }, async ({ env }) => {
      const result = await runCli(["-C", projectDir, "ls"], { env });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("name  resource  snapshot  workflow");
      expect(result.stdout).toContain("api   vm-api    snap-api  smoke");
    });
  });

  test("lists workspaces as JSON", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-cli-ls-json-"));

    await withWorkspaceRuntime({ projectDir }, async ({ env }) => {
      const result = await runCli(["-C", projectDir, "ls", "--json"], { env });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        workspaces: [{
          name: "api",
          workflow: "smoke",
          resourceId: "vm-api",
          snapshotId: "snap-api",
        }],
      });
    });
  });

  test("requires discovered projects for run --all", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-run-all-"));

    try {
      const result = await runCli(["run", "plan", "--all", "--json"], { cwd });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("No fdev projects found.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("requires selection for run --discover with multiple projects", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-run-discover-"));
    mkdirSync(join(cwd, "api"));
    mkdirSync(join(cwd, "web"));
    writeFileSync(join(cwd, "api", "fdev.config.ts"), "export default {}\n");
    writeFileSync(join(cwd, "web", "fdev.config.ts"), "export default {}\n");

    try {
      const result = await runCli(["run", "plan", "--discover", "--json"], { cwd });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Multiple fdev projects found.");
      expect(result.stderr).toContain("pass --all");
      expect(result.stderr).toContain(join(realpathSync(cwd), "api", "fdev.config.ts"));
      expect(result.stderr).toContain(join(realpathSync(cwd), "web", "fdev.config.ts"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

async function runCli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...options.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function withWorkspaceRuntime(
  input: { projectDir: string },
  run: (context: { env: Record<string, string> }) => Promise<void>,
): Promise<void> {
  const fdevHome = mkdtempSync(join(tmpdir(), "fdev-home-"));
  const token = "test-token";
  const configPath = join(input.projectDir, "fdev.config.ts");
  mkdirSync(input.projectDir, { recursive: true });
  writeFileSync(configPath, "export default {}\n");
  const projectId = projectIdFor({ projectDir: input.projectDir, configPath });
  const paths = runtimePaths(projectId, fdevHome);
  mkdirSync(paths.root, { recursive: true });
  writeFileSync(paths.tokenPath, `${token}\n`);

  const now = new Date(0).toISOString();
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
          statePath: join(input.projectDir, ".fdev", "state.sqlite"),
          engineVersion: "engine-test",
          runtimeVersion: "runtime-test",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      if (pathname === "/workspaces") {
        return runtimeJson({
          workspaces: [{
            id: "workspace-api",
            name: "api",
            providerId: "freestyle",
            workflow: "smoke",
            resourceId: "vm-api",
            snapshotId: "snap-api",
            sourceRef: null,
            context: {},
            metadata: {},
            data: {},
            createdAt: now,
            updatedAt: now,
          }],
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

  try {
    await run({ env: { FDEV_HOME: fdevHome } });
  } finally {
    server.stop(true);
    rmSync(fdevHome, { recursive: true, force: true });
    rmSync(input.projectDir, { recursive: true, force: true });
  }
}

function runtimeJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("x-fdev-api-version", String(SUPPORTED_RUNTIME_API_VERSION));
  return Response.json(body, { ...init, headers });
}
