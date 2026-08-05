import { describe, expect, it } from "bun:test";
import { generateWorkspaceName } from "./workspace-name.ts";

describe("generateWorkspaceName", () => {
  it("creates an adjective-noun name", () => {
    expect(generateWorkspaceName([], () => 0)).toBe("snowy-ridge");
  });

  it("does not reuse an existing workspace name", () => {
    const values = [0, 0, 0.1, 0.1];
    let index = 0;

    expect(generateWorkspaceName(["snowy-ridge"], () => values[index++] ?? 0.1)).toBe("bright-harbor");
  });
});
