import { describe, expect, test } from "bun:test";
import { findConfigUp, resolveRigkitProject } from "./project.ts";

describe("VS Code Rigkit project resolution", () => {
  test("finds rig.config.ts by searching upward", () => {
    const existing = new Set([
      "/repo/rig.config.ts",
    ]);

    expect(findConfigUp("/repo/packages/app", (path) => existing.has(path))).toBe("/repo/rig.config.ts");
    expect(resolveRigkitProject("/repo/packages/app", (path) => existing.has(path))).toEqual({
      projectDir: "/repo",
      configPath: "/repo/rig.config.ts",
    });
  });

  test("returns undefined when no config exists", () => {
    expect(findConfigUp("/repo/packages/app", () => false)).toBeUndefined();
  });
});
