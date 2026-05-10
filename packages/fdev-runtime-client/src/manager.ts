import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Readable } from "node:stream";
import { Cause, Effect, Exit } from "effect";
import {
  RuntimeApiVersionError,
  RuntimeConnectionError,
  RuntimeStartupError,
  isRuntimeClientError,
  type RuntimeClientError,
} from "./errors.ts";
import {
  createRuntimeHttpClient,
  type RuntimeHttpClient,
} from "./client.ts";
import {
  SUPPORTED_RUNTIME_API_VERSION,
  runtimeStreamEffect,
} from "./http.ts";
import {
  runtimeSessionEffect,
  type RuntimeSessionHandlers,
} from "./session.ts";
import {
  RuntimeHandleSchema,
  RuntimeReadySchema,
  type RuntimeHandle,
} from "./schemas.ts";

export type RuntimeProjectOptions = {
  projectDir: string;
  configPath: string;
  statePath?: string;
  source?: unknown;
};

export type RuntimeClient = {
  handle: RuntimeHandle;
  paths: RuntimePaths;
  token: string;
  control: RuntimeHttpClient;
  runEvents(
    runId: string,
    onEvent: (event: unknown) => Promise<void> | void,
  ): Promise<void>;
  runSession(
    runId: string,
    handlers: RuntimeSessionHandlers,
  ): Promise<void>;
};

export type RemoteRuntimeOptions = {
  url: string;
  token: string;
};

export type GetOrStartRuntimeOptions = RuntimeProjectOptions & {
  fdevHome?: string;
  idleMs?: number;
};

export type RuntimePaths = {
  root: string;
  handlePath: string;
  tokenPath: string;
  lockPath: string;
};

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
export { SUPPORTED_RUNTIME_API_VERSION };

export async function getOrStartRuntime(options: GetOrStartRuntimeOptions): Promise<RuntimeClient> {
  return runRuntimeClientEffect(getOrStartRuntimeEffect(options));
}

export function getOrStartRuntimeEffect(options: GetOrStartRuntimeOptions): Effect.Effect<RuntimeClient, RuntimeClientError> {
  return Effect.tryPromise({
    try: () => getOrStartRuntimeUnsafe(options),
    catch: toRuntimeClientError,
  });
}

async function getOrStartRuntimeUnsafe(options: GetOrStartRuntimeOptions): Promise<RuntimeClient> {
  const projectDir = resolve(options.projectDir);
  const configPath = resolve(options.configPath);
  const projectId = projectIdFor({ projectDir, configPath });
  const paths = runtimePaths(projectId, options.fdevHome);

  const existing = await tryExistingRuntime(paths, projectId);
  if (existing) return existing;

  await withRuntimeLock(paths.lockPath, async () => {
    const secondCheck = await tryExistingRuntime(paths, projectId);
    if (secondCheck) return;
    await startRuntime({
      ...options,
      projectDir,
      configPath,
      projectId,
      paths,
    });
  });

  const started = await tryExistingRuntime(paths, projectId);
  if (!started) {
    throw new RuntimeStartupError({
      reason: "unhealthy-after-start",
      projectDir,
      message: `fdev runtime did not become healthy for ${projectDir}`,
    });
  }
  return started;
}

export function projectIdFor(options: RuntimeProjectOptions): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    projectDir: resolve(options.projectDir),
    configPath: resolve(options.configPath),
    statePath: options.statePath ? resolve(options.statePath) : null,
    source: options.source ?? null,
  }));
  return `sha256-${hash.digest("hex").slice(0, 32)}`;
}

export function runtimePaths(projectId: string, fdevHome = defaultFdevHome()): RuntimePaths {
  const root = join(fdevHome, "runtimes");
  return {
    root,
    handlePath: join(root, `${projectId}.json`),
    tokenPath: join(root, `${projectId}.token`),
    lockPath: join(root, `${projectId}.lock`),
  };
}

export function defaultFdevHome(): string {
  return process.env.FDEV_HOME ? resolve(process.env.FDEV_HOME) : join(homedir(), ".fdev");
}

async function tryExistingRuntime(paths: RuntimePaths, projectId: string): Promise<RuntimeClient | undefined> {
  const handle = readHandle(paths.handlePath);
  if (!handle || handle.projectId !== projectId) return undefined;
  const token = readToken(handle.tokenPath);
  if (!token) return undefined;

  try {
    const body = await createRuntimeHttpClient({ baseUrl: handle.url, token }).health();
    if (body.projectId !== projectId) {
      throw new RuntimeConnectionError({
        method: "GET",
        path: "/health",
        message: `runtime project mismatch`,
      });
    }
    return createClient(handle, paths, token);
  } catch (error) {
    if (error instanceof RuntimeApiVersionError) throw error;
    removeStale(paths);
    return undefined;
  }
}

async function startRuntime(input: GetOrStartRuntimeOptions & {
  projectId: string;
  paths: RuntimePaths;
}): Promise<void> {
  mkdirSync(input.paths.root, { recursive: true });
  const token = readToken(input.paths.tokenPath) ?? createToken(input.paths.tokenPath);
  const runtimeBin = resolveRuntimeBin(input.projectDir);
  const args = [
    "serve",
    "--project-id",
    input.projectId,
    "--project-dir",
    input.projectDir,
    "--config",
    input.configPath,
    "--handle",
    input.paths.handlePath,
    "--token",
    input.paths.tokenPath,
    "--idle-ms",
    String(input.idleMs ?? DEFAULT_IDLE_MS),
  ];
  if (input.statePath) args.push("--state", input.statePath);
  if (input.source !== undefined) args.push("--source-json", JSON.stringify(input.source));

  const proc = spawn(runtimeBin, args, {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });

  const line = await readReadyLine(proc, input.paths, input.projectDir);
  let ready: ReturnType<typeof RuntimeReadySchema.parse>;
  try {
    ready = RuntimeReadySchema.parse(JSON.parse(line));
  } catch (cause) {
    throw new RuntimeStartupError({
      reason: "invalid-ready-output",
      projectDir: input.projectDir,
      message: `fdev runtime printed invalid ready output`,
      cause,
    });
  }
  if (ready.token && ready.token !== token) {
    writeFileSync(input.paths.tokenPath, `${ready.token}\n`);
  }
  proc.stdout.destroy();
  proc.unref();
}

function createClient(handle: RuntimeHandle, paths: RuntimePaths, token: string): RuntimeClient {
  return {
    handle,
    paths,
    token,
    control: createRuntimeHttpClient({ baseUrl: handle.url, token }),
    runEvents: (runId, onEvent) =>
      runRuntimeClientEffect(runtimeStreamEffect(handle.url, token, runEventsPath(runId), onEvent)),
    runSession: (runId, handlers) =>
      runRuntimeClientEffect(runtimeSessionEffect(handle.url, token, runSessionPath(runId), handlers)),
  };
}

export function connectRemoteRuntime(
  options: RemoteRuntimeOptions,
): Pick<RuntimeClient, "token" | "control" | "runEvents" | "runSession"> {
  const url = options.url.replace(/\/+$/, "");
  const token = options.token;

  return {
    token,
    control: createRuntimeHttpClient({ baseUrl: url, token }),
    runEvents: (runId, onEvent) =>
      runRuntimeClientEffect(runtimeStreamEffect(url, token, runEventsPath(runId), onEvent)),
    runSession: (runId, handlers) =>
      runRuntimeClientEffect(runtimeSessionEffect(url, token, runSessionPath(runId), handlers)),
  };
}

function runEventsPath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}/events`;
}

function runSessionPath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}/session`;
}

async function runRuntimeClientEffect<A>(program: Effect.Effect<A, RuntimeClientError>): Promise<A> {
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

function toRuntimeClientError(cause: unknown, context?: { method: string; path: string }): RuntimeClientError {
  if (isRuntimeClientError(cause)) return cause;
  if (context) {
    return new RuntimeConnectionError({
      method: context.method,
      path: context.path,
      cause,
    });
  }
  return new RuntimeStartupError({
    reason: "unhealthy-after-start",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

async function withRuntimeLock(path: string, run: () => Promise<void>): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      mkdirSync(path);
      try {
        await run();
      } finally {
        rmSync(path, { recursive: true, force: true });
      }
      return;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (isStaleLock(path)) rmSync(path, { recursive: true, force: true });
      await sleep(50);
    }
  }
  throw new RuntimeStartupError({
    reason: "lock-timeout",
    path,
    message: `Timed out waiting for fdev runtime lock ${path}`,
  });
}

function resolveRuntimeBin(projectDir: string): string {
  const local = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "fdev-project-runtime.cmd" : "fdev-project-runtime");
  if (existsSync(local)) return local;
  throw new RuntimeStartupError({
    reason: "missing-runtime",
    projectDir,
    path: local,
    message: [
      `No project-local fdev runtime found at ${local}.`,
      `Install project dependencies so @freestyle-sh/fdev provides the fdev-project-runtime binary.`,
    ].join("\n"),
  });
}

function readHandle(path: string): RuntimeHandle | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return RuntimeHandleSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

function readToken(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const token = readFileSync(path, "utf8").trim();
  return token || undefined;
}

function createToken(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const token = `fdev_${randomUUID().replaceAll("-", "")}`;
  writeFileSync(path, `${token}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms without chmod support.
  }
  return token;
}

function readReadyLine(proc: ChildProcessByStdio<null, Readable, null>, paths: RuntimePaths, projectDir: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      fail(new RuntimeStartupError({
        reason: "startup-timeout",
        projectDir,
        message: `Timed out waiting for fdev runtime to start`,
      }));
    }, 15_000);

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.stdout.off("end", onEnd);
      proc.stdout.off("error", fail);
      proc.off("error", fail);
      proc.off("exit", onExit);
    };

    const resolveLine = (line: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(line);
    };

    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    }

    function onData(chunk: Buffer | string) {
      buffer += String(chunk);
      const index = buffer.indexOf("\n");
      if (index >= 0) resolveLine(buffer.slice(0, index));
    }

    function onEnd() {
      fail(new RuntimeStartupError({
        reason: "exited-before-ready",
        projectDir,
        message: `fdev runtime exited before ready`,
      }));
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      if (code === 0) return;
      removeStale(paths);
      fail(new RuntimeStartupError({
        reason: "exited-before-ready",
        projectDir,
        message: `fdev runtime exited before ready (${signal ?? `exit ${code}`})`,
      }));
    }

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", onData);
    proc.stdout.once("end", onEnd);
    proc.stdout.once("error", fail);
    proc.once("error", fail);
    proc.once("exit", onExit);
  });
}

function removeStale(paths: RuntimePaths): void {
  rmSync(paths.handlePath, { force: true });
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "EEXIST");
}

function isStaleLock(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > 10_000;
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
