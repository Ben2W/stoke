import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigPaths } from "./project.ts";

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
