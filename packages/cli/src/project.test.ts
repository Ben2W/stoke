import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectConfigs, resolveConfigPaths } from "./project.ts";

describe("CLI project resolution", () => {
  test("resolves --chdir to that directory's stoke/index.ts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    mkdirSync(join(cwd, "example", "stoke"), { recursive: true });
    writeFileSync(join(cwd, "example", "stoke", "index.ts"), "export const dev = {}\n");
    const paths = resolveConfigPaths({ cwd, chdir: "example" });

    expect(paths.projectDir).toBe(join(cwd, "example"));
    expect(paths.configPath).toBe(join(cwd, "example", "stoke", "index.ts"));
  });

  test("searches upward from cwd for the nearest config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    mkdirSync(join(cwd, "project", "nested"), { recursive: true });
    mkdirSync(join(cwd, "project", "stoke"), { recursive: true });
    writeFileSync(join(cwd, "project", "stoke", "index.ts"), "export const dev = {}\n");

    const paths = resolveConfigPaths({ cwd: join(cwd, "project", "nested") });

    expect(paths.projectDir).toBe(join(cwd, "project"));
    expect(paths.configPath).toBe(join(cwd, "project", "stoke", "index.ts"));
  });

  test("reports the canonical config when missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));

    expect(() => resolveConfigPaths({ cwd })).toThrow(
      /No Stoke config found from .* upward/,
    );
  });

  test("does not treat stoke.config.ts as a project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    writeFileSync(join(cwd, "stoke.config.ts"), "export const dev = {}\n");

    expect(() => resolveConfigPaths({ cwd })).toThrow(
      /No Stoke config found from .* upward/,
    );
    expect(discoverProjectConfigs({ cwd })).toEqual([]);
  });

  test("discovers projects downward without entering dependency directories", () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    mkdirSync(join(cwd, "api", "stoke"), { recursive: true });
    mkdirSync(join(cwd, "node_modules", "ignored", "stoke"), { recursive: true });
    writeFileSync(join(cwd, "api", "stoke", "index.ts"), "export const api = {}\n");
    writeFileSync(join(cwd, "node_modules", "ignored", "stoke", "index.ts"), "export const ignored = {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([{
      projectDir: join(cwd, "api"),
      configPath: join(cwd, "api", "stoke", "index.ts"),
    }]);
  });

  test("discovers projects downward once per Stoke entrypoint", () => {
    const cwd = mkdtempSync(join(tmpdir(), "stoke-cli-"));
    mkdirSync(join(cwd, "global-fragments", "stoke"), { recursive: true });
    writeFileSync(join(cwd, "global-fragments", "stoke", "index.ts"), "export const api = {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([
      {
        projectDir: join(cwd, "global-fragments"),
        configPath: join(cwd, "global-fragments", "stoke", "index.ts"),
      },
    ]);
  });
});
