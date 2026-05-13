import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdFor, runtimeFingerprintFor, runtimePaths, SUPPORTED_RUNTIME_API_VERSION } from "@rigkit/runtime-client";
import { RIGKIT_CLI_VERSION } from "./version.ts";

const cliPath = join(import.meta.dir, "cli.ts");

describe("CLI entrypoint", () => {
  test("renders CLI diagnostics as JSON", async () => {
    const result = await runCli(["doctor", "--cli", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      cliVersion: RIGKIT_CLI_VERSION,
    });
  });

  test("exposes static help and version bootstrap commands", async () => {
    const rootHelp = await runCli([]);
    expect(rootHelp.exitCode).toBe(0);
    expect(rootHelp.stderr).toBe("");
    expect(rootHelp.stdout).toContain("rig ");
    expect(rootHelp.stdout).toContain("<operation> Run a project operation exposed by the runtime");

    const version = await runCli(["version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout.trim()).toBe(RIGKIT_CLI_VERSION);

    const help = await runCli(["help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("rig ");
    expect(help.stdout).toContain("<operation> Run a project operation exposed by the runtime");
  });

  test("treats unknown root tokens as project operations", async () => {
    const result = await runCli(["unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No Rigkit config found");
  });

  test("serves dynamic shell completion endpoint", async () => {
    const result = await runCli(["__complete", "--shell", "zsh", "--index", "1", "--", "rig", "v"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("version\tshow CLI version");
  });

  test("discovers projects without starting a runtime", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-projects-"));
    mkdirSync(join(cwd, "api"));
    writeFileSync(join(cwd, "api", "rig.config.ts"), "export default {}\n");

    try {
      const result = await runCli(["projects", "--json"], { cwd });
      const realCwd = realpathSync(cwd);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        projects: [{
          projectDir: join(realCwd, "api"),
          configPath: join(realCwd, "api", "rig.config.ts"),
        }],
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("lists workspaces from the project runtime", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-cli-ls-"));

    await withWorkspaceRuntime({ projectDir }, async ({ env }) => {
      const result = await runCli(["-C", projectDir, "ls"], { env });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("name  workflow");
      expect(result.stdout).toContain("api   smoke");
    });
  });

  test("lists workspaces as JSON", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-cli-ls-json-"));

    await withWorkspaceRuntime({ projectDir }, async ({ env }) => {
      const result = await runCli(["-C", projectDir, "ls", "--json"], { env });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        workspaces: [{
          name: "api",
          workflow: "smoke",
          ctx: {},
        }],
      });
    });
  });

  test("requires discovered projects for operation --all", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-run-all-"));

    try {
      const result = await runCli(["plan", "--all", "--json"], { cwd });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("No Rigkit projects found.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("requires selection for operation --discover with multiple projects", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-run-discover-"));
    mkdirSync(join(cwd, "api"));
    mkdirSync(join(cwd, "web"));
    writeFileSync(join(cwd, "api", "rig.config.ts"), "export default {}\n");
    writeFileSync(join(cwd, "web", "rig.config.ts"), "export default {}\n");

    try {
      const result = await runCli(["plan", "--discover", "--json"], { cwd });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Multiple Rigkit projects found.");
      expect(result.stderr).toContain("pass --all");
      expect(result.stderr).toContain(join(realpathSync(cwd), "api", "rig.config.ts"));
      expect(result.stderr).toContain(join(realpathSync(cwd), "web", "rig.config.ts"));
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
          runtimeFingerprint,
          projectDir: input.projectDir,
          configPath,
          statePath: join(input.projectDir, ".rigkit", "state.sqlite"),
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
            workflow: "smoke",
            ctx: {},
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
      runtimeFingerprint,
      projectDir: input.projectDir,
      configPath,
      pid: process.pid,
      url: `http://127.0.0.1:${server.port}`,
      tokenPath: paths.tokenPath,
    }, null, 2)}\n`,
  );

  try {
    await run({ env: { RIGKIT_HOME: rigkitHome } });
  } finally {
    server.stop(true);
    rmSync(rigkitHome, { recursive: true, force: true });
    rmSync(input.projectDir, { recursive: true, force: true });
  }
}

function runtimeJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("x-rigkit-api-version", String(SUPPORTED_RUNTIME_API_VERSION));
  return Response.json(body, { ...init, headers });
}
