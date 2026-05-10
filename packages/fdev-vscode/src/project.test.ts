import { describe, expect, test } from "bun:test";
import { findConfigUp, resolveFdevProject } from "./project.ts";

describe("VS Code fdev project resolution", () => {
  test("finds fdev.config.ts by searching upward", () => {
    const existing = new Set([
      "/repo/fdev.config.ts",
    ]);

    expect(findConfigUp("/repo/packages/app", (path) => existing.has(path))).toBe("/repo/fdev.config.ts");
    expect(resolveFdevProject("/repo/packages/app", (path) => existing.has(path))).toEqual({
      projectDir: "/repo",
      configPath: "/repo/fdev.config.ts",
    });
  });

  test("returns undefined when no config exists", () => {
    expect(findConfigUp("/repo/packages/app", () => false)).toBeUndefined();
  });
});
