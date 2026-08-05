import { describe, expect, test } from "bun:test";
import {
  initialOperationInput,
  operationHasInput,
  operationInputProperties,
  operationRequiredFields,
  parseOperationInput,
} from "./operation-input.ts";

describe("operation input schema", () => {
  const schema = {
    properties: {
      path: { type: "string", default: "/" },
      retries: { type: "integer" },
      public: { type: "boolean", default: true },
      region: { type: "string", enum: ["iad1", "sfo1"] },
    },
    required: ["path", "retries"],
  };

  test("derives fields and defaults from JSON schema", () => {
    const properties = operationInputProperties(schema);
    expect(operationHasInput(schema)).toBe(true);
    expect(operationRequiredFields(schema)).toEqual(new Set(["path", "retries"]));
    expect(initialOperationInput(properties)).toEqual({ path: "/", retries: "", public: true, region: "" });
  });

  test("parses typed values for the operation request", () => {
    expect(parseOperationInput(operationInputProperties(schema), operationRequiredFields(schema), {
      path: "/about",
      retries: "2",
      public: false,
      region: "sfo1",
    })).toEqual({ path: "/about", retries: 2, public: false, region: "sfo1" });
  });

  test("rejects missing required values and invalid integers", () => {
    const properties = operationInputProperties(schema);
    const required = operationRequiredFields(schema);
    expect(() => parseOperationInput(properties, required, { path: "/", retries: "" })).toThrow("Retries is required");
    expect(() => parseOperationInput(properties, required, { path: "/", retries: "1.5" })).toThrow("valid integer");
  });
});
