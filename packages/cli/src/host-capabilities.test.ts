import { describe, expect, test } from "bun:test";
import {
  assertHostCapabilities,
  effectiveCliHostCapabilities,
} from "./host-capabilities.ts";

describe("CLI host capabilities", () => {
  test("loads locally trusted provider handlers", () => {
    expect(effectiveCliHostCapabilities({}).map((capability) => capability.id))
      .toEqual(["browser.open", "cmux.call", "ssh", "vscode.open"]);
  });

  test("claims only dashboard-owned capabilities from a dashboard runner", () => {
    expect(effectiveCliHostCapabilities({ STOKE_WORKSPACE_ORIGIN: "dashboard" }).map((capability) => capability.id))
      .toEqual(["browser.open", "ssh"]);
  });

  test("rejects missing and incompatible capabilities before execution", () => {
    expect(() => assertHostCapabilities({
      id: "shell",
      requiredCapabilities: [{ id: "ssh", schemaHash: "sha256:v1" }],
    }, [])).toThrow('requires host capability "ssh"');

    expect(() => assertHostCapabilities({
      id: "shell",
      requiredCapabilities: [{ id: "ssh", schemaHash: "sha256:v1" }],
    }, [{ id: "ssh", schemaHash: "sha256:v2" }])).toThrow("sha256:v2");

    expect(() => assertHostCapabilities({
      id: "shell",
      requiredCapabilities: [{ id: "ssh", schemaHash: "sha256:v1" }],
    }, [{ id: "ssh", schemaHash: "sha256:v1" }])).not.toThrow();
  });
});
