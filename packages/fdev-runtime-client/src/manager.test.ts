import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectRemoteRuntime,
  getOrStartRuntime,
  projectIdFor,
  runtimePaths,
  SUPPORTED_RUNTIME_API_VERSION,
} from "./manager.ts";
import {
  RuntimeApiVersionError,
  RuntimeAuthError,
  RuntimeProtocolError,
  RuntimeStartupError,
} from "./errors.ts";

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
    const differentSource = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/fdev.config.ts",
      source: { kind: "github", commitSha: "abc" },
    });

    expect(first).toBe(second);
    expect(first.startsWith("sha256-")).toBe(true);
    expect(differentConfig).not.toBe(first);
    expect(differentSource).not.toBe(first);
  });

  test("includes config contents in local runtime ids", () => {
    const root = mkdtempSync(join(tmpdir(), "fdev-runtime-client-id-"));
    try {
      const projectDir = join(root, "project");
      const configPath = join(projectDir, "fdev.config.ts");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(configPath, "export default { name: 'one' }\n");

      const first = projectIdFor({ projectDir, configPath });
      const second = projectIdFor({ projectDir, configPath });
      writeFileSync(configPath, "export default { name: 'two' }\n");
      const changed = projectIdFor({ projectDir, configPath });

      expect(second).toBe(first);
      expect(changed).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("derives handle, token, and lock paths from fdev home", () => {
    const paths = runtimePaths("sha256-test", "/tmp/fdev-home");

    expect(paths.root).toBe(join("/tmp/fdev-home", "runtimes"));
    expect(paths.handlePath).toBe(join("/tmp/fdev-home", "runtimes", "sha256-test.json"));
    expect(paths.tokenPath).toBe(join("/tmp/fdev-home", "runtimes", "sha256-test.token"));
    expect(paths.lockPath).toBe(join("/tmp/fdev-home", "runtimes", "sha256-test.lock"));
  });

  test("remote run event clients reject unsupported runtime API versions", async () => {
    let path = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        path = new URL(request.url).pathname;
        return new Response("", {
          headers: { "x-fdev-api-version": String(SUPPORTED_RUNTIME_API_VERSION + 1) },
        });
      },
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.runEvents("run/id", () => {})).rejects.toThrow("Unsupported fdev runtime API version");
      await expect(runtime.runEvents("run/id", () => {})).rejects.toBeInstanceOf(RuntimeApiVersionError);
      expect(path).toBe("/runs/run%2Fid/events");
    } finally {
      server.stop(true);
    }
  });

  test("remote control clients use the typed runtime API", async () => {
    const metadata = {
      apiVersion: SUPPORTED_RUNTIME_API_VERSION,
      engineVersion: "engine-test",
      runtimeVersion: "runtime-test",
      protocolHash: "sha256:test",
    };
    let authorization = "";
    let path = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        authorization = request.headers.get("authorization") ?? "";
        path = new URL(request.url).pathname;
        return Response.json(metadata, {
          headers: { "x-fdev-api-version": String(SUPPORTED_RUNTIME_API_VERSION) },
        });
      },
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.control.runtime()).resolves.toEqual(metadata);
      expect(path).toBe("/runtime");
      expect(authorization).toBe("Bearer test-token");
    } finally {
      server.stop(true);
    }
  });

  test("remote control clients reject unsupported runtime API versions", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json(
        {
          apiVersion: SUPPORTED_RUNTIME_API_VERSION + 1,
          engineVersion: "engine-test",
          runtimeVersion: "runtime-test",
          protocolHash: "sha256:test",
        },
        { headers: { "x-fdev-api-version": String(SUPPORTED_RUNTIME_API_VERSION + 1) } },
      ),
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.control.runtime()).rejects.toThrow("Unsupported fdev runtime API version");
      await expect(runtime.control.runtime()).rejects.toBeInstanceOf(RuntimeApiVersionError);
    } finally {
      server.stop(true);
    }
  });

  test("remote clients expose typed auth failures", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json(
        { error: { message: "bad token" } },
        {
          status: 401,
          headers: { "x-fdev-api-version": String(SUPPORTED_RUNTIME_API_VERSION) },
        },
      ),
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.control.runtime()).rejects.toThrow("bad token");
      await expect(runtime.control.runtime()).rejects.toBeInstanceOf(RuntimeAuthError);
    } finally {
      server.stop(true);
    }
  });

  test("remote clients expose typed protocol failures", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("{", {
        headers: { "x-fdev-api-version": String(SUPPORTED_RUNTIME_API_VERSION) },
      }),
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.control.runtime()).rejects.toBeInstanceOf(RuntimeProtocolError);
    } finally {
      server.stop(true);
    }
  });

  test("local manager exposes typed missing runtime failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "fdev-runtime-client-"));
    try {
      const projectDir = join(root, "project");
      const fdevHome = join(root, "home");

      await expect(getOrStartRuntime({
        projectDir,
        configPath: join(projectDir, "fdev.config.ts"),
        fdevHome,
      })).rejects.toBeInstanceOf(RuntimeStartupError);
      await expect(getOrStartRuntime({
        projectDir,
        configPath: join(projectDir, "fdev.config.ts"),
        fdevHome,
      })).rejects.toMatchObject({ reason: "missing-runtime" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
