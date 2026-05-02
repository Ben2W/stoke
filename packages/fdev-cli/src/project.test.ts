import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertVersionAlignment, resolveConfigPaths } from "./project.ts";
import { FDEV_CLI_VERSION } from "./version.ts";

describe("CLI project resolution", () => {
  test("resolves -C to that directory's fdev.config.ts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-"));
    const paths = resolveConfigPaths({ cwd, project: "example" });

    expect(paths.projectDir).toBe(join(cwd, "example"));
    expect(paths.configPath).toBe(join(cwd, "example", "fdev.config.ts"));
  });

  test("resolves --config project root from the config dirname", () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-"));
    const paths = resolveConfigPaths({ cwd, config: "machines/platform.ts" });

    expect(paths.projectDir).toBe(join(cwd, "machines"));
    expect(paths.configPath).toBe(join(cwd, "machines", "platform.ts"));
  });
});

describe("version alignment", () => {
  test("passes when the local SDK version matches the CLI", () => {
    const projectDir = projectWithSdkVersion(FDEV_CLI_VERSION);
    expect(() => assertVersionAlignment(projectDir)).not.toThrow();
  });

  test("errors when the local SDK version differs", () => {
    const projectDir = projectWithSdkVersion("9.9.9");
    expect(() => assertVersionAlignment(projectDir)).toThrow("fdev version mismatch");
  });

  test("errors when the local SDK is missing", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-cli-"));
    expect(() => assertVersionAlignment(projectDir)).toThrow("No local @freestyle-sh/fdev-sdk install found");
  });
});

function projectWithSdkVersion(version: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), "fdev-cli-"));
  const packageDir = join(projectDir, "node_modules", "@freestyle-sh", "fdev-sdk");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  return projectDir;
}
