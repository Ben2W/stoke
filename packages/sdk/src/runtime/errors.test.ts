import { describe, expect, test } from "bun:test";
import {
  RuntimeEngineError,
  runtimeFailureBody,
} from "./errors.ts";

describe("runtime failure serialization", () => {
  test("preserves cause chain details for run logs", () => {
    const upstream = new Error("INTERNAL_ERROR: Internal server error") as Error & {
      body: Record<string, unknown>;
      statusCode: number;
    };
    upstream.name = "InternalErrorError";
    upstream.statusCode = 500;
    upstream.body = {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId: "req_123",
      authorization: "Bearer secret-token",
    };

    const body = runtimeFailureBody(new RuntimeEngineError({ cause: upstream }));

    expect(body.code).toBe("ENGINE_FAILED");
    expect(body.message).toBe("INTERNAL_ERROR: Internal server error");
    expect(body.details?.name).toBe("RuntimeEngineError");
    expect(body.details?.cause).toMatchObject({
      name: "InternalErrorError",
      message: "INTERNAL_ERROR: Internal server error",
      statusCode: 500,
      body: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: "req_123",
        authorization: "[redacted]",
      },
    });
  });
});
