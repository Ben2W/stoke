import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectConfigs, resolveConfigPaths } from "./project.ts";

describe("CLI project resolution", () => {
  test("resolves -C to that directory's fdev.config.ts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-"));
    mkdirSync(join(cwd, "example"));
    writeFileSync(join(cwd, "example", "fdev.config.ts"), "export default {}\n");
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

  test("searches upward from cwd for the nearest config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-"));
    mkdirSync(join(cwd, "project", "nested"), { recursive: true });
    writeFileSync(join(cwd, "project", "fdev.config.ts"), "export default {}\n");

    const paths = resolveConfigPaths({ cwd: join(cwd, "project", "nested") });

    expect(paths.projectDir).toBe(join(cwd, "project"));
    expect(paths.configPath).toBe(join(cwd, "project", "fdev.config.ts"));
  });

  test("discovers projects downward without entering dependency directories", () => {
    const cwd = mkdtempSync(join(tmpdir(), "fdev-cli-"));
    mkdirSync(join(cwd, "api"), { recursive: true });
    mkdirSync(join(cwd, "node_modules", "ignored"), { recursive: true });
    writeFileSync(join(cwd, "api", "fdev.config.ts"), "export default {}\n");
    writeFileSync(join(cwd, "node_modules", "ignored", "fdev.config.ts"), "export default {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([{
      projectDir: join(cwd, "api"),
      configPath: join(cwd, "api", "fdev.config.ts"),
    }]);
  });
});
