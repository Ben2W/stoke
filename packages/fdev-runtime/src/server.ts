import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FDEV_ENGINE_VERSION } from "@freestyle-sh/fdev-engine";
import { FDEV_RUNTIME_VERSION } from "./version.ts";
import { createRuntimeApp } from "./app.ts";
import { DEFAULT_IDLE_MS } from "./protocol.ts";
import { createRunStore } from "./runs.ts";
import { readOrCreateToken } from "./token.ts";
import type { RuntimeContext, RuntimeServer, ServeRuntimeOptions } from "./types.ts";

export async function serveRuntime(options: ServeRuntimeOptions): Promise<RuntimeServer> {
  const projectDir = resolve(options.projectDir);
  const configPath = resolve(options.configPath);
  const statePath = options.statePath ? resolve(options.statePath) : undefined;
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? readOrCreateToken(options.tokenPath);
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const startedAt = new Date().toISOString();
  const store = createRunStore();
  let expiresAt = new Date(Date.now() + idleMs).toISOString();
  let url = "";
  let stopServer = () => {};

  const writeHandle = () => {
    mkdirSync(dirname(options.handlePath), { recursive: true });
    writeFileSync(
      options.handlePath,
      `${JSON.stringify({
        projectId: options.projectId,
        projectDir,
        configPath,
        pid: process.pid,
        url,
        tokenPath: options.tokenPath,
        engineVersion: FDEV_ENGINE_VERSION,
        runtimeVersion: FDEV_RUNTIME_VERSION,
        startedAt,
        expiresAt,
      }, null, 2)}\n`,
    );
  };

  const context: RuntimeContext = {
    projectId: options.projectId,
    projectDir,
    configPath,
    statePath,
    token,
    startedAt,
    getExpiresAt: () => expiresAt,
    touch: () => {
      expiresAt = new Date(Date.now() + idleMs).toISOString();
      if (url) writeHandle();
    },
    stop: () => stopServer(),
  };
  const app = createRuntimeApp(context, store);
  const server = Bun.serve({
    hostname: host,
    port: options.port ?? 0,
    fetch: app.fetch,
  });
  stopServer = () => server.stop(true);

  url = `http://${host}:${server.port}`;
  writeHandle();

  const idleTimer = setInterval(() => {
    if ([...store.runs.values()].some((run) => run.status === "running")) return;
    if (Date.now() <= Date.parse(expiresAt)) return;
    server.stop(true);
    clearInterval(idleTimer);
  }, Math.min(idleMs, 30_000));
  idleTimer.unref?.();

  return {
    url,
    token,
    stop() {
      clearInterval(idleTimer);
      server.stop(true);
    },
  };
}

export type { RuntimeServer, ServeRuntimeOptions } from "./types.ts";
