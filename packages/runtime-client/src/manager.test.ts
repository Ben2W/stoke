import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectRemoteRuntime,
  getOrStartRuntime,
  projectIdFor,
  runtimeFingerprintFor,
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
      configPath: "/tmp/project/rigkit/index.ts",
    });
    const second = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/rigkit/index.ts",
    });
    const differentConfig = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/rigkit/other.ts",
    });
    const differentSource = projectIdFor({
      projectDir: "/tmp/project",
      configPath: "/tmp/project/rigkit/index.ts",
      source: { kind: "github", commitSha: "abc" },
    });

    expect(first).toBe(second);
    expect(first.startsWith("sha256-")).toBe(true);
    expect(differentConfig).not.toBe(first);
    expect(differentSource).not.toBe(first);
  });

  test("keeps project ids stable while config fingerprints change", () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-client-id-"));
    try {
      const projectDir = join(root, "project");
      const configPath = join(projectDir, "rigkit", "index.ts");
      mkdirSync(join(projectDir, "rigkit"), { recursive: true });
      writeFileSync(configPath, "export default { name: 'one' }\n");

      const first = projectIdFor({ projectDir, configPath });
      const second = projectIdFor({ projectDir, configPath });
      const firstFingerprint = runtimeFingerprintFor({ projectDir, configPath });
      writeFileSync(configPath, "export default { name: 'two' }\n");
      const changed = projectIdFor({ projectDir, configPath });
      const changedFingerprint = runtimeFingerprintFor({ projectDir, configPath });

      expect(second).toBe(first);
      expect(changed).toBe(first);
      expect(changedFingerprint).not.toBe(firstFingerprint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("changes runtime fingerprints when rigkit helper files change", () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-client-helper-fingerprint-"));
    try {
      const projectDir = join(root, "project");
      const configPath = join(projectDir, "rigkit", "index.ts");
      const helperPath = join(projectDir, "rigkit", "shared", "inputs.ts");
      mkdirSync(join(projectDir, "rigkit", "shared"), { recursive: true });
      writeFileSync(configPath, "export { workflow } from './shared/inputs.ts'\n");
      writeFileSync(helperPath, "export const scope = 'test:unit'\n");

      const first = runtimeFingerprintFor({ projectDir, configPath });
      writeFileSync(helperPath, "export const scope = 'test:integration'\n");
      const changed = runtimeFingerprintFor({ projectDir, configPath });

      expect(changed).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("restarts local runtimes when the runtime fingerprint changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-client-restart-"));
    let first: Awaited<ReturnType<typeof getOrStartRuntime>> | undefined;
    let second: Awaited<ReturnType<typeof getOrStartRuntime>> | undefined;

    try {
      const projectDir = join(root, "project");
      const rigkitHome = join(root, "home");
      const configPath = join(projectDir, "rigkit", "index.ts");
      mkdirSync(join(projectDir, "rigkit"), { recursive: true });
      writeFileSync(configPath, "export default { name: 'one' }\n");
      writeFakeRuntimeBin(projectDir);

      first = await getOrStartRuntime({
        projectDir,
        configPath,
        rigkitHome,
        idleMs: 60_000,
      });
      const firstHealth = await first.control.health();

      writeFileSync(configPath, "export default { name: 'two' }\n");
      second = await getOrStartRuntime({
        projectDir,
        configPath,
        rigkitHome,
        idleMs: 60_000,
      });
      const secondHealth = await second.control.health();

      expect(second.handle.projectId).toBe(first.handle.projectId);
      expect(second.paths.handlePath).toBe(first.paths.handlePath);
      expect(second.handle.runtimeFingerprint).not.toBe(first.handle.runtimeFingerprint);
      expect(second.handle.pid).not.toBe(first.handle.pid);
      expect(secondHealth.runtimeFingerprint).toBe(second.handle.runtimeFingerprint);
      expect(firstHealth.projectId).toBe(secondHealth.projectId);
    } finally {
      await second?.control.shutdown().catch(() => {});
      await first?.control.shutdown().catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("restarts local runtimes when nested rigkit files change", async () => {
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-client-helper-restart-"));
    let first: Awaited<ReturnType<typeof getOrStartRuntime>> | undefined;
    let second: Awaited<ReturnType<typeof getOrStartRuntime>> | undefined;

    try {
      const projectDir = join(root, "project");
      const rigkitHome = join(root, "home");
      const configPath = join(projectDir, "rigkit", "index.ts");
      const helperPath = join(projectDir, "rigkit", "shared", "inputs.ts");
      mkdirSync(join(projectDir, "rigkit", "shared"), { recursive: true });
      writeFileSync(configPath, "export { workflow } from './shared/inputs.ts'\n");
      writeFileSync(helperPath, "export const scope = 'test:unit'\n");
      writeFakeRuntimeBin(projectDir);

      first = await getOrStartRuntime({
        projectDir,
        configPath,
        rigkitHome,
        idleMs: 60_000,
      });

      writeFileSync(helperPath, "export const scope = 'test:integration'\n");
      second = await getOrStartRuntime({
        projectDir,
        configPath,
        rigkitHome,
        idleMs: 60_000,
      });

      expect(second.handle.projectId).toBe(first.handle.projectId);
      expect(second.handle.runtimeFingerprint).not.toBe(first.handle.runtimeFingerprint);
      expect(second.handle.pid).not.toBe(first.handle.pid);
    } finally {
      await second?.control.shutdown().catch(() => {});
      await first?.control.shutdown().catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("derives handle, token, and lock paths from rigkit home", () => {
    const paths = runtimePaths("sha256-test", "/tmp/rigkit-home");

    expect(paths.root).toBe(join("/tmp/rigkit-home", "runtimes"));
    expect(paths.handlePath).toBe(join("/tmp/rigkit-home", "runtimes", "sha256-test.json"));
    expect(paths.tokenPath).toBe(join("/tmp/rigkit-home", "runtimes", "sha256-test.token"));
    expect(paths.lockPath).toBe(join("/tmp/rigkit-home", "runtimes", "sha256-test.lock"));
  });

  test("remote run event clients reject unsupported runtime API versions", async () => {
    let path = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        path = new URL(request.url).pathname;
        return new Response("", {
          headers: { "x-rigkit-api-version": String(SUPPORTED_RUNTIME_API_VERSION + 1) },
        });
      },
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.runEvents("run/id", () => {})).rejects.toThrow("Unsupported Rigkit runtime API version");
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
          headers: { "x-rigkit-api-version": String(SUPPORTED_RUNTIME_API_VERSION) },
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
        { headers: { "x-rigkit-api-version": String(SUPPORTED_RUNTIME_API_VERSION + 1) } },
      ),
    });

    try {
      const runtime = connectRemoteRuntime({
        url: `http://127.0.0.1:${server.port}`,
        token: "test-token",
      });

      await expect(runtime.control.runtime()).rejects.toThrow("Unsupported Rigkit runtime API version");
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
          headers: { "x-rigkit-api-version": String(SUPPORTED_RUNTIME_API_VERSION) },
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
        headers: { "x-rigkit-api-version": String(SUPPORTED_RUNTIME_API_VERSION) },
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
    const root = mkdtempSync(join(tmpdir(), "rigkit-runtime-client-"));
    try {
      const projectDir = join(root, "project");
      const rigkitHome = join(root, "home");

      await expect(getOrStartRuntime({
        projectDir,
        configPath: join(projectDir, "rigkit", "index.ts"),
        rigkitHome,
      })).rejects.toBeInstanceOf(RuntimeStartupError);
      await expect(getOrStartRuntime({
        projectDir,
        configPath: join(projectDir, "rigkit", "index.ts"),
        rigkitHome,
      })).rejects.toMatchObject({ reason: "missing-runtime" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeFakeRuntimeBin(projectDir: string): void {
  const binDir = join(projectDir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, process.platform === "win32" ? "rigkit-project-runtime.cmd" : "rigkit-project-runtime");
  writeFileSync(
    binPath,
    `#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const options = {};
for (let i = 1; i < args.length; i += 2) {
  options[args[i].replace(/^--/, "")] = args[i + 1];
}

const token = readFileSync(options.token, "utf8").trim();
let server;
server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("authorization") !== \`Bearer \${token}\`) {
      return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        projectId: options["project-id"],
        runtimeFingerprint: options["runtime-fingerprint"],
        projectDir: resolve(options["project-dir"]),
        configPath: resolve(options.config),
        statePath: options.state ? resolve(options.state) : undefined,
        engineVersion: "engine-test",
        runtimeVersion: "runtime-test",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, { headers: { "x-rigkit-api-version": "${SUPPORTED_RUNTIME_API_VERSION}" } });
    }
    if (url.pathname === "/shutdown") {
      setTimeout(() => {
        server.stop(true);
        process.exit(0);
      }, 0);
      return Response.json({ ok: true }, { headers: { "x-rigkit-api-version": "${SUPPORTED_RUNTIME_API_VERSION}" } });
    }
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  },
});

const handle = {
  projectId: options["project-id"],
  runtimeFingerprint: options["runtime-fingerprint"],
  projectDir: resolve(options["project-dir"]),
  configPath: resolve(options.config),
  statePath: options.state ? resolve(options.state) : undefined,
  pid: process.pid,
  url: \`http://127.0.0.1:\${server.port}\`,
  tokenPath: resolve(options.token),
};
mkdirSync(dirname(options.handle), { recursive: true });
writeFileSync(options.handle, JSON.stringify(handle));
console.log(JSON.stringify({ type: "ready", url: handle.url, token }));
await new Promise(() => {});
`,
  );
  chmodSync(binPath, 0o755);
}
