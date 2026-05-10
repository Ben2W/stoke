import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  options: { cwd?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
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
