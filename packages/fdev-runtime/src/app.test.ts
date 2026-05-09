import { describe, expect, test } from "bun:test";
import { createRuntimeApp } from "./app.ts";
import { RUNTIME_API_VERSION, RUNTIME_PROTOCOL_HASH } from "./protocol.ts";
import { createRunStore } from "./runs.ts";
import type { RuntimeContext } from "./types.ts";

describe("runtime HTTP app", () => {
  test("exposes runtime metadata with protocol headers", async () => {
    const app = createRuntimeApp(testContext(), createRunStore());

    const unauthenticated = await app.request("/runtime");
    expect(unauthenticated.status).toBe(401);

    const response = await app.request("/runtime", {
      headers: { authorization: "Bearer test-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-fdev-api-version")).toBe(String(RUNTIME_API_VERSION));
    expect(response.headers.get("x-fdev-protocol-hash")).toBe(RUNTIME_PROTOCOL_HASH);
    expect(body.apiVersion).toBe(RUNTIME_API_VERSION);
    expect(body.protocolHash).toBe(RUNTIME_PROTOCOL_HASH);
  });

  test("returns structured validation errors", async () => {
    const app = createRuntimeApp(testContext(), createRunStore());

    const response = await app.request("/runs", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: {} }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("operation");
  });
});

function testContext(): RuntimeContext {
  return {
    projectId: "project-test",
    projectDir: "/tmp/fdev-project",
    configPath: "/tmp/fdev-project/fdev.config.ts",
    token: "test-token",
    startedAt: "2026-01-01T00:00:00.000Z",
    getExpiresAt: () => "2026-01-01T00:30:00.000Z",
    touch: () => {},
    stop: () => {},
  };
}
