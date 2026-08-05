import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectConfigs, resolveConfigPaths } from "./project.ts";

describe("CLI project resolution", () => {
  test("resolves --chdir to that directory's rigkit/index.ts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "example", "rigkit"), { recursive: true });
    writeFileSync(join(cwd, "example", "rigkit", "index.ts"), "export const dev = {}\n");
    const paths = resolveConfigPaths({ cwd, chdir: "example" });

    expect(paths.projectDir).toBe(join(cwd, "example"));
    expect(paths.configPath).toBe(join(cwd, "example", "rigkit", "index.ts"));
  });

  test("searches upward from cwd for the nearest config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "project", "nested"), { recursive: true });
    mkdirSync(join(cwd, "project", "rigkit"), { recursive: true });
    writeFileSync(join(cwd, "project", "rigkit", "index.ts"), "export const dev = {}\n");

    const paths = resolveConfigPaths({ cwd: join(cwd, "project", "nested") });

    expect(paths.projectDir).toBe(join(cwd, "project"));
    expect(paths.configPath).toBe(join(cwd, "project", "rigkit", "index.ts"));
  });

  test("reports the canonical config when missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));

    expect(() => resolveConfigPaths({ cwd })).toThrow(
      /No Stoke config found from .* upward/,
    );
  });

  test("does not treat stoke.config.ts as a project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    writeFileSync(join(cwd, "stoke.config.ts"), "export const dev = {}\n");

    expect(() => resolveConfigPaths({ cwd })).toThrow(
      /No Stoke config found from .* upward/,
    );
    expect(discoverProjectConfigs({ cwd })).toEqual([]);
  });

  test("discovers projects downward without entering dependency directories", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "api", "rigkit"), { recursive: true });
    mkdirSync(join(cwd, "node_modules", "ignored", "rigkit"), { recursive: true });
    writeFileSync(join(cwd, "api", "rigkit", "index.ts"), "export const api = {}\n");
    writeFileSync(join(cwd, "node_modules", "ignored", "rigkit", "index.ts"), "export const ignored = {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([{
      projectDir: join(cwd, "api"),
      configPath: join(cwd, "api", "rigkit", "index.ts"),
    }]);
  });

  test("discovers projects downward once per rigkit entrypoint", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "global-fragments", "rigkit"), { recursive: true });
    writeFileSync(join(cwd, "global-fragments", "rigkit", "index.ts"), "export const api = {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([
      {
        projectDir: join(cwd, "global-fragments"),
        configPath: join(cwd, "global-fragments", "rigkit", "index.ts"),
      },
    ]);
  });
});
