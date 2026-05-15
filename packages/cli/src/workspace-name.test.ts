import { describe, expect, test } from "bun:test";
import { generateWorkspaceName } from "./workspace-name.ts";

describe("workspace name defaults", () => {
  test("generates shell-safe adjective noun names", () => {
    expect(generateWorkspaceName([], () => 0)).toBe("snowy-ridge");
  });

  test("skips generated names that already exist", () => {
    const randomValues = [0, 0, 0.5, 0.5];
    let index = 0;
    const name = generateWorkspaceName(["snowy-ridge"], () => randomValues[index++] ?? 0.5);

    expect(name).not.toBe("snowy-ridge");
    expect(name).toMatch(/^(?!-)[A-Za-z0-9._-]+$/);
  });
});
