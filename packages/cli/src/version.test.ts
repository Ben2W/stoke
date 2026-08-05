import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STOKE_CLI_VERSION } from "./version.ts";

describe("CLI version", () => {
  test("matches the published package version", () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(STOKE_CLI_VERSION).toBe(packageJson.version);
  });
});
