import { describe, expect, test } from "bun:test";
import { wrapCommand } from "./provider.ts";

describe("Freestyle provider command wrapper", () => {
  test("sets a root HOME fallback for exec commands", () => {
    expect(wrapCommand("printf '%s\n' \"$HOME\"")).toContain("export HOME=${HOME:-/root}");
  });

  test("allows callers to override HOME explicitly", () => {
    const wrapped = wrapCommand("pwd", {
      env: { HOME: "/workspace/home" },
    });

    expect(wrapped).toContain("export HOME=${HOME:-/root}");
    expect(wrapped).toContain("export HOME='\\''/workspace/home'\\''");
  });
});
