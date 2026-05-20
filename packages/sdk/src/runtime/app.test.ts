import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createRuntimeControlApiHandler } from "./api-handlers.ts";
import { createRuntimeApp } from "./app.ts";
import {
  RuntimeOperationValidationError,
} from "./errors.ts";
import { loadEngine, operationManifestFor } from "./operations.ts";
import {
  HostCommandRequestSchema,
  HostCommandResultSchema,
  HostResponseSchema,
  RUNTIME_API_VERSION,
  RUNTIME_PROTOCOL_HASH,
} from "./protocol.ts";
import { createRun, createRunStore } from "./runs.ts";
import { serveRuntime, serveRuntimeEffect } from "./server.ts";
import type { RuntimeContext } from "./types.ts";

function rigkitIndexPath(projectDir: string): string {
  return join(projectDir, "rigkit", "index.ts");
}

function writeRigkitIndex(projectDir: string, contents: string): string {
  const configPath = rigkitIndexPath(projectDir);
  mkdirSync(join(projectDir, "rigkit"), { recursive: true });
  writeFileSync(configPath, contents);
  return configPath;
}

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
    expect(response.headers.get("x-rigkit-api-version")).toBe(String(RUNTIME_API_VERSION));
    expect(response.headers.get("x-rigkit-protocol-hash")).toBe(RUNTIME_PROTOCOL_HASH);
    expect(body.apiVersion).toBe(RUNTIME_API_VERSION);
    expect(body.protocolHash).toBe(RUNTIME_PROTOCOL_HASH);
  });

  test("serves control endpoints through Effect HttpApiBuilder handlers", async () => {
    const { handler, dispose } = createRuntimeControlApiHandler(testContext(), createRunStore());

    try {
      const unauthenticated = await handler(new Request("http://runtime.local/runtime"));
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("x-rigkit-api-version")).toBe(String(RUNTIME_API_VERSION));

      const runtimeResponse = await handler(new Request("http://runtime.local/runtime", {
        headers: { authorization: "Bearer test-token" },
      }));
      const runtimeBody = await runtimeResponse.json();
      expect(runtimeResponse.status).toBe(200);
      expect(runtimeResponse.headers.get("x-rigkit-protocol-hash")).toBe(RUNTIME_PROTOCOL_HASH);
      expect(runtimeBody.apiVersion).toBe(RUNTIME_API_VERSION);

      const missingRun = await handler(new Request("http://runtime.local/runs/missing", {
        headers: { authorization: "Bearer test-token" },
      }));
      const missingRunBody = await missingRun.json();
      expect(missingRun.status).toBe(404);
      expect(missingRunBody.error.message).toBe("Unknown run missing");
    } finally {
      await dispose();
    }
  });

  test("resolves host responses through Effect HttpApiBuilder handlers", async () => {
    const store = createRunStore();
    const run = createRun("needs-host", {});
    run.pendingHostRequestIds.add("host_req_test");
    store.runs.set(run.id, run);

    let resolved: unknown;
    store.hostResponses.set("host_req_test", {
      resolve: (value) => {
        resolved = value;
      },
      reject: (error) => {
        throw error;
      },
    });

    const { handler, dispose } = createRuntimeControlApiHandler(testContext(), store);

    try {
      const response = await handler(new Request("http://runtime.local/host-responses/host_req_test", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ result: { ok: true } }),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(resolved).toEqual({ ok: true });
      expect(store.hostResponses.has("host_req_test")).toBe(false);
      expect(run.pendingHostRequestIds.has("host_req_test")).toBe(false);
    } finally {
      await dispose();
    }
  });

  test("serveRuntimeEffect stops the runtime server when its scope closes", async () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-effect-"));
    let url = "";
    let closed: Promise<void> | undefined;

    try {
      writeNoopConfig(root);
      await Effect.runPromise(Effect.scoped(
        Effect.flatMap(
          serveRuntimeEffect({
            projectId: "test-project",
            projectDir: root,
            configPath: rigkitIndexPath(root),
            handlePath: join(root, "runtime.json"),
            tokenPath: join(root, "runtime.token"),
            token: "test-token",
            idleMs: 60_000,
        }),
          (server) => Effect.promise(async () => {
            url = server.url;
            closed = server.closed;
            const response = await fetch(new URL("/health", server.url), {
              headers: { connection: "close" },
            });
            expect(response.status).toBe(200);
          }),
        ),
      ));

      await closed;
      await expect(fetch(new URL("/health", url), {
        headers: { connection: "close" },
      })).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shutdown resolves the runtime server closed promise", async () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-shutdown-"));

    try {
      writeNoopConfig(root);
      const server = await serveRuntime({
        projectId: "test-project",
        projectDir: root,
        configPath: rigkitIndexPath(root),
        handlePath: join(root, "runtime.json"),
        tokenPath: join(root, "runtime.token"),
        token: "test-token",
        idleMs: 60_000,
      });
      const response = await fetch(new URL("/shutdown", server.url), {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      });

      expect(response.status).toBe(200);
      await server.closed;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("loads config before reporting runtime readiness", async () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-startup-config-"));
    const configPath = writeRigkitIndex(root, "throw new Error('startup config failed');\n");

    try {
      await expect(serveRuntime({
        projectId: "test-project",
        projectDir: root,
        configPath,
        handlePath: join(root, "runtime.json"),
        tokenPath: join(root, "runtime.token"),
        token: "test-token",
        idleMs: 60_000,
      })).rejects.toThrow("startup config failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  test("serves a structured OpenAPI control-plane document", async () => {
    const app = createRuntimeApp(testContext(), createRunStore());

    const response = await app.request("/openapi.json", {
      headers: { authorization: "Bearer test-token" },
    });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body.security).toEqual([{ bearerAuth: [] }]);
    expect(body.paths["/health"].get.security).toEqual([]);
    expect(body.paths["/runs"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/RunOperationRequest",
    });
    expect(body.paths["/runs/{runId}"].get.parameters).toEqual([
      {
        name: "runId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ]);
    expect(body.paths["/host-responses/{requestId}"].post.requestBody.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/HostResponse",
    });
    expect(body.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });
    expect(body.components.schemas.RuntimeOperation.required).toContain("inputSchema");
    expect(body.components.schemas.Workspace.required).toContain("ctx");
    expect(body.components.schemas.OperationsManifest.required).toEqual([
      "operations",
      "workspaceOperations",
    ]);
  });

  test("accepts interactive host command protocol payloads", () => {
    expect(HostCommandRequestSchema.parse({
      argv: ["ssh", "root@127.0.0.1"],
      mode: "interactive",
    }).mode).toBe("interactive");
    expect(HostCommandResultSchema.parse({
      exitCode: 0,
      stdout: null,
      stderr: null,
    })).toEqual({
      exitCode: 0,
      stdout: null,
      stderr: null,
    });
    expect(HostResponseSchema.parse({
      error: { code: "HOST_CAPABILITY_FAILED", message: "cmux is not running" },
    })).toEqual({
      error: { code: "HOST_CAPABILITY_FAILED", message: "cmux is not running" },
    });
  });

  test("projects config-defined operations into the runtime manifest", () => {
    const manifest = operationManifestFor({
      listWorkflows: () => [{ name: "test" }],
      listRuntimeOperations: () => [
        {
          workflow: "",
          id: "ssh",
          source: "core",
          kind: "command",
          title: "SSH",
          description: "Get an SSH command",
          inputFields: [
            { kind: "string", name: "workflow", required: false },
            { kind: "string", name: "workspaceOrVmId", position: 0, required: true },
            { kind: "string", name: "user", required: false },
            { kind: "boolean", name: "print", required: false, defaultValue: false },
          ],
          cli: {
            positionals: [{ name: "workspaceOrVmId", index: 0 }],
            options: [
              { name: "workflow", flag: "--workflow" },
              { name: "user", flag: "--user" },
              { name: "print", flag: "--print", type: "boolean" },
            ],
          },
        },
        {
          workflow: "test",
          id: "open",
          source: "config",
          title: "Open",
          description: "Open a workspace",
          inputFields: [
            {
              kind: "workspace",
              name: "workspace",
              description: "Workspace to open",
              position: 0,
              required: true,
            },
            {
              kind: "boolean",
              name: "rebuild",
              description: "Rebuild before opening",
              required: false,
              defaultValue: false,
            },
          ],
        },
        {
          workflow: "",
          id: "create",
          source: "core",
          kind: "command",
          createsWorkspace: true,
          inputFields: [{ kind: "string", name: "name", required: true }],
        },
      ],
      listRuntimeWorkspaceOperations: () => [
        {
          workflow: "test",
          id: "remove",
          source: "core",
          kind: "workspace-action",
          title: "Remove",
          description: "Remove a workspace",
          inputFields: [],
        },
        {
          workflow: "test",
          id: "open-cmux",
          source: "config",
          kind: "workspace-action",
          title: "Open cmux",
          description: "Open a workspace in cmux",
          inputFields: [
            {
              kind: "string",
              name: "layout",
              description: "cmux layout name",
              required: false,
            },
          ],
        },
      ],
    } as any);

    const operation = manifest.operations.find((item) => item.id === "open");
    const createOperation = manifest.operations.find((item) => item.id === "create");
    const sshOperation = manifest.operations.find((item) => item.id === "ssh");
    const cmuxOperation = manifest.workspaceOperations.find((item) => item.id === "open-cmux");
    const inputSchema = operation?.inputSchema as any;
    const sshInputSchema = sshOperation?.inputSchema as any;

    expect(operation?.source).toBe("config");
    expect(operation?.kind).toBe("workspace-action");
    expect(cmuxOperation?.id).toBe("open-cmux");
    expect(operation?.cli?.positionals).toEqual([{ name: "workspace", index: 0 }]);
    expect(operation?.cli?.options).toEqual([
      { name: "rebuild", flag: "--rebuild", required: false, type: "boolean" },
    ]);
    expect(inputSchema.required).toEqual(["workspace"]);
    expect(inputSchema.properties.workspace["x-rigkit-input"]).toEqual({
      kind: "workspace",
      workflow: "test",
      resolve: "data",
    });
    expect(inputSchema.properties.rebuild).toMatchObject({
      type: "boolean",
      default: false,
      description: "Rebuild before opening",
    });
    expect(createOperation?.source).toBe("core");
    expect(createOperation?.createsWorkspace).toBe(true);
    expect(manifest.workspaceOperations.map((item) => item.id)).toEqual(["remove", "open-cmux"]);
    expect(cmuxOperation?.cli?.options).toEqual([
      { name: "layout", flag: "--layout", required: false, type: "string" },
    ]);
    expect((cmuxOperation?.inputSchema as any).properties.layout).toMatchObject({
      type: "string",
      description: "cmux layout name",
    });
    expect(sshOperation?.cli?.options?.find((item) => item.name === "print")).toEqual({
      name: "print",
      flag: "--print",
      type: "boolean",
    });
    expect(sshInputSchema.properties.print).toEqual({ type: "boolean", default: false });
  });

  test("rejects config operation ids reserved by host commands", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-runtime-reserved-operation-"));
    const configPath = writeRigkitIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/../../../engine/src/index.ts";

        export const root = sequence("reserved-test").operation("completion", {
          run: async () => ({ ok: true }),
        });
      `,
    );

    try {
      await expect(loadEngine({ projectDir, configPath }))
        .rejects.toThrow("reserved by the Rigkit host");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("negotiates run sessions with hello acknowledgements and heartbeats", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-runtime-session-"));
    const configPath = writeRigkitIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/../../../engine/src/index.ts";

        export const root = sequence("session-test").step("noop", async () => ({ ctx: { ok: true } }));
      `,
    );

    const server = await serveRuntime({
      projectId: "project-session-test",
      projectDir,
      configPath,
      statePath: join(projectDir, "state.sqlite"),
      handlePath: join(projectDir, "runtime.json"),
      tokenPath: join(projectDir, "runtime.token"),
      token: "test-token",
      idleMs: 60_000,
    });

    try {
      const workflows = await fetch(new URL("/workflows", server.url), {
        headers: { authorization: `Bearer ${server.token}` },
      }).then((response) => response.json() as Promise<{ workflows: Array<{ name: string }> }>);
      expect(workflows.workflows.map((workflow) => workflow.name)).toEqual(["session-test"]);

      const started = await fetch(new URL("/runs", server.url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operation: "plan", input: { workflow: "session-test" } }),
      }).then((response) => response.json() as Promise<{ sessionUrl: string }>);

      const messages = await collectSessionMessages(new URL(started.sessionUrl, server.url), server.token);
      const ack = messages.find((message) => message.type === "hello.ack");

      expect(ack?.operation).toEqual({
        id: "plan",
      });
      expect(messages.some((message) => message.type === "heartbeat.ack")).toBe(true);
      expect(messages.some((message) => message.type === "run.completed")).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("exposes persisted workspace payload as workspace context", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-runtime-workspace-ctx-"));
    const configPath = writeRigkitIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/../../../engine/src/index.ts";

        export const root = sequence("workspace-ctx")
          .step("prepare", async () => ({ ctx: { repoPath: "/workspace/repo" } }))
          .workspace({
            create: async ({ workflow, workspace }) => ({
              name: workspace.name,
              vmId: "vm-" + workspace.name,
              repoPath: workflow.ctx.repoPath,
            }),
            remove: async () => {},
          });
      `,
    );

    const server = await serveRuntime({
      projectId: "project-workspace-ctx-test",
      projectDir,
      configPath,
      statePath: join(projectDir, "state.sqlite"),
      handlePath: join(projectDir, "runtime.json"),
      tokenPath: join(projectDir, "runtime.token"),
      token: "test-token",
      idleMs: 60_000,
    });

    try {
      const started = await fetch(new URL("/runs", server.url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operation: "create", input: { workflow: "workspace-ctx", name: "demo" } }),
      }).then((response) => response.json() as Promise<{ sessionUrl: string }>);

      await collectSessionMessages(new URL(started.sessionUrl, server.url), server.token);

      const { workspaces } = await fetch(new URL("/workspaces", server.url), {
        headers: { authorization: `Bearer ${server.token}` },
      }).then((response) => response.json() as Promise<{ workspaces: Array<{ ctx: Record<string, unknown> }> }>);

      expect(workspaces[0]?.ctx).toEqual({
        name: "demo",
        vmId: "vm-demo",
        repoPath: "/workspace/repo",
      });
    } finally {
      server.stop();
    }
  });

  test("reports typed operation validation failures on run events", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-runtime-validation-"));
    const configPath = writeRigkitIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/../../../engine/src/index.ts";

        export const root = sequence("validation")
          .step("prepare", async () => ({ ctx: { ok: true } }))
          .workspace({
            create: async ({ workspace }) => ({ name: workspace.name, vmId: "vm-" + workspace.name }),
            remove: async () => {},
          });
      `,
    );

    const server = await serveRuntime({
      projectId: "project-validation-test",
      projectDir,
      configPath,
      statePath: join(projectDir, "state.sqlite"),
      handlePath: join(projectDir, "runtime.json"),
      tokenPath: join(projectDir, "runtime.token"),
      token: "test-token",
      idleMs: 60_000,
    });

    try {
      const started = await fetch(new URL("/runs", server.url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operation: "create", input: { workflow: "validation" } }),
      }).then((response) => response.json() as Promise<{ sessionUrl: string }>);

      const messages = await collectSessionMessages(
        new URL(started.sessionUrl, server.url),
        server.token,
        { done: (items) => items.some((item) => item.type === "run.failed") },
      );
      const failed = messages.find((message) => message.type === "run.failed");

      expect(failed?.error?.code).toBe("OPERATION_VALIDATION_FAILED");
      expect(failed?.error?.message).toContain("Invalid input for operation create");
      expect(new RuntimeOperationValidationError({ operation: "create", cause: "missing name" }).code)
        .toBe("OPERATION_VALIDATION_FAILED");
    } finally {
      server.stop();
    }
  });

  test("bridges typed host capability requests over run sessions", async () => {
    const { server, projectDir } = await serveRuntimeFixture("rigkit-runtime-capability-", `
      export const root = sequence("capability-test").operation("open", {
        run: async ({ local }) => await local.requestCapability("cmux.call", { name: "demo" }),
      });
    `);

    try {
      const started = await startRun(server, "open");
      const messages = await collectSessionMessages(
        new URL(started.sessionUrl, server.url),
        server.token,
        {
          hello: helloWithCapability(),
          onMessage(message, ws) {
            if (message.type !== "host.capability.request") return;
            ws.send(JSON.stringify({
              type: "response",
              id: message.id,
              result: { sessionId: "cmux-session-1" },
            }));
          },
          done: (items) => items.some((item) => item.type === "run.completed"),
        },
      );

      const request = messages.find((message) => message.type === "host.capability.request");
      const completed = messages.find((message) => message.type === "run.completed");
      expect(request).toMatchObject({
        type: "host.capability.request",
        capability: "cmux.call",
        params: { name: "demo" },
      });
      expect(completed?.result).toEqual({ sessionId: "cmux-session-1" });
    } finally {
      server.stop();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("resolves host capability resource lifetimes from session close reports", async () => {
    const { server, projectDir } = await serveRuntimeFixture("rigkit-runtime-capability-close-", `
      export const root = sequence("capability-close-test").operation("open", {
        run: async ({ local }) => {
          if (!local.requestCapabilitySession) throw new Error("requestCapabilitySession unavailable");
          const session = await local.requestCapabilitySession("cmux.call", { name: "demo" });
          await session.closed;
          return session.result;
        },
      });
    `);

    try {
      const started = await startRun(server, "open");
      const messages = await collectSessionMessages(
        new URL(started.sessionUrl, server.url),
        server.token,
        {
          hello: helloWithCapability(),
          onMessage(message, ws) {
            if (message.type !== "host.capability.request") return;
            ws.send(JSON.stringify({
              type: "response",
              id: message.id,
              result: { sessionId: "cmux-session-1" },
            }));
            setTimeout(() => ws.send(JSON.stringify({
              type: "host.capability.closed",
              id: message.id,
            })), 10);
          },
          done: (items) => items.some((item) => item.type === "run.completed"),
        },
      );

      const completed = messages.find((message) => message.type === "run.completed");
      expect(completed?.result).toEqual({ sessionId: "cmux-session-1" });
    } finally {
      server.stop();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("keeps host-owned capability runs attached until the host cancels", async () => {
    const { server, projectDir } = await serveRuntimeFixture("rigkit-runtime-capability-attached-", `
      export const root = sequence("capability-attached-test").operation("open", {
        run: async ({ local }) => {
          await local.requestCapability("cmux.call", { name: "demo" });
          await new Promise(() => {});
        },
      });
    `);

    try {
      const started = await startRun(server, "open");
      const messages = await collectSessionMessages(
        new URL(started.sessionUrl, server.url),
        server.token,
        {
          hello: helloWithCapability(),
          onMessage(message, ws) {
            if (message.type !== "host.capability.request") return;
            ws.send(JSON.stringify({
              type: "response",
              id: message.id,
              result: { sessionId: "cmux-session-1" },
            }));
            setTimeout(() => ws.send(JSON.stringify({ type: "run.cancel" })), 0);
          },
          done: (items) => items.some((item) => item.type === "run.failed"),
        },
      );

      const request = messages.find((message) => message.type === "host.capability.request");
      const failed = messages.find((message) => message.type === "run.failed");
      expect(request?.capability).toBe("cmux.call");
      expect(messages.some((message) => message.type === "run.completed")).toBe(false);
      expect(failed?.error?.code).toBe("RUN_CANCELLED");
    } finally {
      server.stop();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("turns host response errors into typed host request failures", async () => {
    const { server, projectDir } = await serveRuntimeFixture("rigkit-runtime-capability-error-", `
      export const root = sequence("capability-error-test").operation("cmux-call", {
        run: async ({ local }) => await local.requestCapability("cmux.call", { name: "demo" }),
      });
    `);

    try {
      const started = await startRun(server, "cmux-call");
      const messages = await collectSessionMessages(
        new URL(started.sessionUrl, server.url),
        server.token,
        {
          hello: helloWithCapability(),
          onMessage(message, ws) {
            if (message.type !== "host.capability.request") return;
            ws.send(JSON.stringify({
              type: "response",
              id: message.id,
              error: { code: "HOST_CAPABILITY_FAILED", message: "cmux is not running" },
            }));
          },
          done: (items) => items.some((item) => item.type === "run.failed"),
        },
      );

      const failed = messages.find((message) => message.type === "run.failed");
      expect(failed?.error?.code).toBe("HOST_REQUEST_FAILED");
      expect(failed?.error?.message).toContain("cmux is not running");
    } finally {
      server.stop();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("turns run.cancel session messages into run failures", async () => {
    const { server, projectDir } = await serveRuntimeFixture("rigkit-runtime-cancel-", `
      export const root = sequence("cancel-test").operation("long-running", {
        run: async () => await new Promise(() => {}),
      });
    `);

    try {
      const started = await startRun(server, "long-running");
      const messages = await collectSessionMessages(
        new URL(started.sessionUrl, server.url),
        server.token,
        {
          afterOpen: (ws) => {
            setTimeout(() => ws.send(JSON.stringify({ type: "run.cancel" })), 0);
          },
          done: (items) => items.some((item) => item.type === "run.failed"),
        },
      );
      const failed = messages.find((message) => message.type === "run.failed");

      expect(failed?.error?.code).toBe("RUN_CANCELLED");
      expect(failed?.error?.message).toBe("Run cancelled by host");
    } finally {
      server.stop();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function writeNoopConfig(projectDir: string): void {
  writeRigkitIndex(projectDir,
    `
      import { sequence } from "${import.meta.dir}/../../../engine/src/index.ts";

      export const root = sequence("noop").step("ready", async () => ({ ctx: { ready: true } }));
    `,
  );
}

async function serveRuntimeFixture(prefix: string, configBody: string) {
  const projectDir = mkdtempSync(join(tmpdir(), prefix));
  const configPath = writeRigkitIndex(projectDir,
    `
      import { sequence } from "${import.meta.dir}/../../../engine/src/index.ts";

      ${configBody}
    `,
  );
  const server = await serveRuntime({
    projectId: prefix.replace(/[^a-z0-9-]/gi, ""),
    projectDir,
    configPath,
    statePath: join(projectDir, "state.sqlite"),
    handlePath: join(projectDir, "runtime.json"),
    tokenPath: join(projectDir, "runtime.token"),
    token: "test-token",
    idleMs: 60_000,
  });
  return { projectDir, server };
}

async function startRun(
  server: { url: string; token: string },
  operation: string,
  input: unknown = {},
): Promise<{ runId: string; sessionUrl: string }> {
  const response = await fetch(new URL("/runs", server.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${server.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ operation, input }),
  });
  expect(response.status).toBe(202);
  return await response.json() as { runId: string; sessionUrl: string };
}

function helloWithCapability(): Record<string, unknown> {
  return {
    type: "hello",
    transportVersion: 1,
    host: { name: "test", version: "0.0.0" },
    hostMethods: [],
    hostCapabilities: [{ id: "cmux.call", schemaHash: "sha256:cmux-call-schema" }],
  };
}

async function collectSessionMessages(
  url: URL,
  token: string,
  options: {
    hello?: Record<string, unknown>;
    afterOpen?: (ws: WebSocket) => void;
    onMessage?: (message: any, ws: WebSocket) => void;
    done?: (messages: any[]) => boolean;
  } = {},
): Promise<any[]> {
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const messages: any[] = [];
  const ws = new (WebSocket as unknown as {
    new(url: string | URL, options?: Bun.WebSocketOptions): WebSocket;
  })(url, {
    headers: { authorization: `Bearer ${token}` },
  });

  return await Promise.race([
    new Promise<any[]>((resolve, reject) => {
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify(options.hello ?? {
          type: "hello",
          transportVersion: 1,
          host: { name: "test", version: "0.0.0" },
          hostMethods: [],
          hostCapabilities: [],
        }));
        ws.send(JSON.stringify({ type: "heartbeat" }));
        options.afterOpen?.(ws);
      });
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        messages.push(message);
        options.onMessage?.(message, ws);
        const done = options.done ?? ((items: any[]) =>
          items.some((item) => item.type === "hello.ack") &&
          items.some((item) => item.type === "heartbeat.ack") &&
          items.some((item) => item.type === "run.completed")
        );
        if (done(messages)) {
          ws.close();
          resolve(messages);
        }
      });
      ws.addEventListener("error", () => reject(new Error(`WebSocket session failed`)));
    }),
    new Promise<any[]>((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for run session messages")), 5_000);
    }),
  ]);
}

function testContext(): RuntimeContext {
  return {
    projectId: "project-test",
    projectDir: "/tmp/rigkit-project",
    configPath: "/tmp/rigkit-project/rigkit/index.ts",
    token: "test-token",
    startedAt: "2026-01-01T00:00:00.000Z",
    getExpiresAt: () => "2026-01-01T00:30:00.000Z",
    touch: () => {},
    stop: () => {},
  };
}
