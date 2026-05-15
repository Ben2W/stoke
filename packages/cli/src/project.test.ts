import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectConfigs, resolveConfigPaths } from "./project.ts";

describe("CLI project resolution", () => {
  test("resolves -C to that directory's rig.config.ts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "example"));
    writeFileSync(join(cwd, "example", "rig.config.ts"), "export default {}\n");
    const paths = resolveConfigPaths({ cwd, project: "example" });

    expect(paths.projectDir).toBe(join(cwd, "example"));
    expect(paths.configPath).toBe(join(cwd, "example", "rig.config.ts"));
  });

  test("resolves --config project root from the config dirname", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    const paths = resolveConfigPaths({ cwd, config: "machines/platform.ts" });

    expect(paths.projectDir).toBe(join(cwd, "machines"));
    expect(paths.configPath).toBe(join(cwd, "machines", "platform.ts"));
  });

  test("searches upward from cwd for the nearest config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "project", "nested"), { recursive: true });
    writeFileSync(join(cwd, "project", "rig.config.ts"), "export default {}\n");

    const paths = resolveConfigPaths({ cwd: join(cwd, "project", "nested") });

    expect(paths.projectDir).toBe(join(cwd, "project"));
    expect(paths.configPath).toBe(join(cwd, "project", "rig.config.ts"));
  });

  test("reports named configs when the default config is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    writeFileSync(join(cwd, "api.rig.config.ts"), "export default {}\n");
    writeFileSync(join(cwd, "web.rig.config.ts"), "export default {}\n");

    expect(() => resolveConfigPaths({ cwd })).toThrow(
      /Found named Rigkit configs[\s\S]*api\.rig\.config\.ts[\s\S]*web\.rig\.config\.ts[\s\S]*rig -C \. --config api\.rig\.config\.ts <command>/,
    );
  });

  test("discovers projects downward without entering dependency directories", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "api"), { recursive: true });
    mkdirSync(join(cwd, "node_modules", "ignored"), { recursive: true });
    writeFileSync(join(cwd, "api", "rig.config.ts"), "export default {}\n");
    writeFileSync(join(cwd, "node_modules", "ignored", "rig.config.ts"), "export default {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([{
      projectDir: join(cwd, "api"),
      configPath: join(cwd, "api", "rig.config.ts"),
    }]);
  });

  test("discovers named configs downward", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rigkit-cli-"));
    mkdirSync(join(cwd, "global-fragments"), { recursive: true });
    writeFileSync(join(cwd, "global-fragments", "api.rig.config.ts"), "export default {}\n");
    writeFileSync(join(cwd, "global-fragments", "web.rig.config.ts"), "export default {}\n");

    const projects = discoverProjectConfigs({ cwd });

    expect(projects).toEqual([
      {
        projectDir: join(cwd, "global-fragments"),
        configPath: join(cwd, "global-fragments", "api.rig.config.ts"),
      },
      {
        projectDir: join(cwd, "global-fragments"),
        configPath: join(cwd, "global-fragments", "web.rig.config.ts"),
      },
    ]);
  });
});
