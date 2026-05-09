import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { projectIdFor, runtimePaths } from "./manager.ts";

describe("runtime manager", () => {
  test("computes stable ids from project and config paths", () => {
    const first = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/fdev.config.ts",
    });
    const second = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/fdev.config.ts",
    });
    const differentConfig = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/other.config.ts",
    });

    expect(first).toBe(second);
    expect(first.startsWith("sha256-")).toBe(true);
    expect(differentConfig).not.toBe(first);
  });

  test("derives handle, token, and lock paths from fdev home", () => {
    const paths = runtimePaths("sha256-test", "/tmp/fdev-home");

    expect(paths.root).toBe(join("/tmp/fdev-home", "runtimes"));
    expect(paths.handlePath).toBe(join("/tmp/fdev-home", "runtimes", "sha256-test.json"));
    expect(paths.tokenPath).toBe(join("/tmp/fdev-home", "runtimes", "sha256-test.token"));
    expect(paths.lockPath).toBe(join("/tmp/fdev-home", "runtimes", "sha256-test.lock"));
  });
});
