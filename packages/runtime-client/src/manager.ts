import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  managedState?: { projectId: string; revision: number; apiUrl: string; token: string };
  stateFile?: string;
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
  stokeHome?: string;
  idleMs?: number;
};

export type RuntimePaths = {
  root: string;
  handlePath: string;
  tokenPath: string;
  lockPath: string;
  // Where the daemon's stderr is captured. The CLI tails this on run failure
  // so users see real stack traces instead of "Internal server error".
  runtimeLogPath: string;
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
  const canonicalConfigPath = join(projectDir, "stoke", "index.ts");
  if (configPath !== canonicalConfigPath) {
    throw new RuntimeStartupError({
      reason: "missing-runtime",
      projectDir,
      path: configPath,
      message: `Stoke config must be ${canonicalConfigPath}; ${configPath} is not supported.`,
    });
  }
  const projectId = projectIdFor({
    projectDir,
    configPath,
    managedState: options.managedState,
    stateFile: options.stateFile,
    source: options.source,
  });
  const runtimeFingerprint = runtimeFingerprintFor({
    projectDir,
    configPath,
    managedState: options.managedState,
    stateFile: options.stateFile,
    source: options.source,
  });
  const paths = runtimePaths(projectId, options.stokeHome);

  const existing = await tryExistingRuntime(paths, projectId, runtimeFingerprint);
  if (existing) return existing;

  await withRuntimeLock(paths.lockPath, async () => {
    const secondCheck = await tryExistingRuntime(paths, projectId, runtimeFingerprint);
    if (secondCheck) return;
    await startRuntime({
      ...options,
      projectDir,
      configPath,
      projectId,
      runtimeFingerprint,
      paths,
    });
  });

  const started = await tryExistingRuntime(paths, projectId, runtimeFingerprint);
  if (!started) {
    throw new RuntimeStartupError({
      reason: "unhealthy-after-start",
      projectDir,
      message: `Stoke runtime did not become healthy for ${projectDir}`,
    });
  }
  return started;
}

export function projectIdFor(options: RuntimeProjectOptions): string {
  const configPath = resolve(options.configPath);
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    projectDir: resolve(options.projectDir),
    configPath,
    managedProjectId: options.managedState?.projectId ?? null,
    stateFile: options.stateFile ? resolve(options.stateFile) : null,
    source: options.source ?? null,
  }));
  return `sha256-${hash.digest("hex").slice(0, 32)}`;
}

export function runtimeFingerprintFor(options: RuntimeProjectOptions): string {
  const projectDir = resolve(options.projectDir);
  const configPath = resolve(options.configPath);
  const stateFile = options.stateFile ? resolve(options.stateFile) : null;
  const hash = createHash("sha256");

  hash.update("project\0");
  hash.update(projectDir);
  hash.update("\0config\0");
  hash.update(configPath);
  hash.update("\0managed-project\0");
  hash.update(options.managedState?.projectId ?? "");
  hash.update("\0managed-state-revision\0");
  hash.update(String(options.managedState?.revision ?? ""));
  hash.update("\0state-file\0");
  hash.update(stateFile ?? "");
  hash.update("\0source\0");
  hash.update(JSON.stringify(options.source ?? null));

  updateFileFingerprint(hash, "config", configPath);
  updateDirectoryFingerprint(hash, "config-dir", dirname(configPath));
  for (const file of dotenvFilesFor(projectDir)) updateFileFingerprint(hash, "dotenv", file);
  for (const file of projectFingerprintFiles(projectDir)) updateFileFingerprint(hash, "project-file", file);
  updateProjectSurfaceFingerprint(hash, projectDir);
  updateStokePackageFingerprint(hash, join(projectDir, "node_modules", "@usestoke"));

  return `sha256-${hash.digest("hex")}`;
}

export function runtimePaths(projectId: string, stokeHome = defaultStokeHome()): RuntimePaths {
  const root = join(stokeHome, "runtimes");
  return {
    root,
    handlePath: join(root, `${projectId}.json`),
    tokenPath: join(root, `${projectId}.token`),
    lockPath: join(root, `${projectId}.lock`),
    runtimeLogPath: join(root, `${projectId}.log`),
  };
}

export function defaultStokeHome(): string {
  return process.env.STOKE_HOME ? resolve(process.env.STOKE_HOME) : join(homedir(), ".stoke");
}

async function tryExistingRuntime(
  paths: RuntimePaths,
  projectId: string,
  runtimeFingerprint: string,
): Promise<RuntimeClient | undefined> {
  const handle = readHandle(paths.handlePath);
  if (!handle || handle.projectId !== projectId) return undefined;
  const token = readToken(handle.tokenPath);
  if (!token) {
    removeStale(paths);
    return undefined;
  }

  if (handle.runtimeFingerprint !== runtimeFingerprint) {
    await shutdownRuntime(handle, token);
    removeStale(paths);
    return undefined;
  }

  try {
    const body = await createRuntimeHttpClient({ baseUrl: handle.url, token }).health();
    if (body.projectId !== projectId) {
      throw new RuntimeConnectionError({
        method: "GET",
        path: "/health",
        message: `runtime project mismatch`,
      });
    }
    if (body.runtimeFingerprint !== runtimeFingerprint) {
      throw new RuntimeConnectionError({
        method: "GET",
        path: "/health",
        message: `runtime fingerprint mismatch`,
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
  runtimeFingerprint: string;
  paths: RuntimePaths;
}): Promise<void> {
  mkdirSync(input.paths.root, { recursive: true });
  const token = readToken(input.paths.tokenPath) ?? createToken(input.paths.tokenPath);
  const runtimeBin = resolveRuntimeBin(input.projectDir);
  const args = [
    "serve",
    "--project-id",
    input.projectId,
    "--runtime-fingerprint",
    input.runtimeFingerprint,
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
  if (input.managedState) {
    args.push("--managed-project-id", input.managedState.projectId);
    args.push("--managed-api-url", input.managedState.apiUrl);
  }
  if (input.stateFile) args.push("--state-file", resolve(input.stateFile));
  if (input.source !== undefined) args.push("--source-json", JSON.stringify(input.source));

  mkdirSync(input.paths.root, { recursive: true });
  const stderrFd = openSync(input.paths.runtimeLogPath, "a");
  const proc = spawn(runtimeBin, args, {
    detached: true,
    stdio: ["ignore", "pipe", stderrFd],
    env: {
      ...process.env,
      ...(input.managedState ? { STOKE_RUNTIME_TOKEN: input.managedState.token } : {}),
    },
  }) as ChildProcessByStdio<null, Readable, null>;
  // The child inherits the fd; the parent can release its own handle.
  try {
    closeSync(stderrFd);
  } catch {
    // best-effort
  }

  const line = await readReadyLine(proc, input.paths, input.projectDir);
  let ready: ReturnType<typeof RuntimeReadySchema.parse>;
  try {
    ready = RuntimeReadySchema.parse(JSON.parse(line));
  } catch (cause) {
    throw new RuntimeStartupError({
      reason: "invalid-ready-output",
      projectDir: input.projectDir,
      message: `Stoke runtime printed invalid ready output`,
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
    message: `Timed out waiting for Stoke runtime lock ${path}`,
  });
}

function resolveRuntimeBin(projectDir: string): string {
  const override = process.env.STOKE_RUNTIME_BIN?.trim();
  if (override && existsSync(override)) return override;
  const local = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "stoke-project-runtime.cmd" : "stoke-project-runtime");
  if (existsSync(local)) return local;
  throw new RuntimeStartupError({
    reason: "missing-runtime",
    projectDir,
    path: local,
    message: [
      `No project-local Stoke runtime found at ${local}.`,
      `Install project dependencies so @usestoke/sdk provides the stoke-project-runtime binary.`,
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
  const token = `stoke_${randomUUID().replaceAll("-", "")}`;
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
        message: `Timed out waiting for Stoke runtime to start`,
      }), { kill: true });
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

    function fail(error: unknown, options: { kill?: boolean } = {}) {
      if (settled) return;
      settled = true;
      cleanup();
      if (options.kill) killRuntimeProcess(proc);
      removeStale(paths);
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
        message: `Stoke runtime exited before ready`,
      }));
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      if (code === 0) return;
      removeStale(paths);
      fail(new RuntimeStartupError({
        reason: "exited-before-ready",
        projectDir,
        message: `Stoke runtime exited before ready (${signal ?? `exit ${code}`})`,
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

function killRuntimeProcess(proc: ChildProcessByStdio<null, Readable, null>): void {
  if (!proc.pid) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // Best effort. The startup path will discard the stale handle either way.
  }
}

function removeStale(paths: RuntimePaths): void {
  rmSync(paths.handlePath, { force: true });
}

async function shutdownRuntime(handle: RuntimeHandle, token: string): Promise<void> {
  try {
    await createRuntimeHttpClient({ baseUrl: handle.url, token }).shutdown();
  } catch {
    if (handle.pid !== process.pid) {
      try {
        process.kill(handle.pid);
      } catch {
        // Best effort. The stale handle is still removed below.
      }
    }
  }
}

function updateFileFingerprint(hash: ReturnType<typeof createHash>, label: string, path: string): void {
  hash.update(`\0${label}\0${path}\0`);
  if (!existsSync(path)) {
    hash.update("missing");
    return;
  }

  const stat = statSync(path);
  if (!stat.isFile()) {
    hash.update(`not-file:${stat.mode}`);
    return;
  }

  hash.update(readFileSync(path));
}

function updateDirectoryFingerprint(hash: ReturnType<typeof createHash>, label: string, path: string): void {
  hash.update(`\0${label}\0${path}\0`);
  if (!existsSync(path)) {
    hash.update("missing");
    return;
  }

  const stat = statSync(path);
  if (!stat.isDirectory()) {
    hash.update(`not-directory:${stat.mode}`);
    return;
  }

  for (const file of collectFiles(path)) {
    updateFileFingerprint(hash, label, file);
  }
}

function projectFingerprintFiles(projectDir: string): string[] {
  return [
    "package.json",
    "bun.lock",
    "bun.lockb",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ].map((file) => join(projectDir, file));
}

function updateProjectSurfaceFingerprint(hash: ReturnType<typeof createHash>, projectDir: string): void {
  if (!existsSync(projectDir)) return;
  const ignored = new Set([".git", ".stoke", "node_modules", "dist", "build", ".next", ".astro"]);
  const entries = readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => !ignored.has(entry.name))
    .map((entry) => `${entry.name}:${entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"}`)
    .sort();
  hash.update("\0project-surface\0");
  hash.update(entries.join("\n"));
}

function updateStokePackageFingerprint(hash: ReturnType<typeof createHash>, scopeDir: string): void {
  // Walk every @usestoke scope reachable from the project's node_modules. We
  // recurse into each package's own `node_modules/@usestoke` so that nested
  // installs (e.g. @usestoke/engine living under @usestoke/sdk/node_modules) are
  // hashed too. Without this, edits to a transitive @usestoke package wouldn't
  // shift the runtime fingerprint and the daemon wouldn't auto-restart.
  const visited = new Set<string>();
  const stack: string[] = [scopeDir];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (!existsSync(dir)) continue;
    let canonical: string;
    try {
      canonical = realpathSync(dir);
    } catch {
      continue;
    }
    if (visited.has(canonical)) continue;
    visited.add(canonical);

    const packageDirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(dir, entry.name))
      .sort();

    for (const packageDir of packageDirs) {
      updateFileFingerprint(hash, "stoke-package", join(packageDir, "package.json"));
      for (const file of collectFiles(join(packageDir, "src"))) {
        updateFileFingerprint(hash, "stoke-source", file);
      }
      // Recurse into this package's own @usestoke scope, if it has nested deps.
      stack.push(join(packageDir, "node_modules", "@usestoke"));
    }
  }
}

function collectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit(root);
  return out.sort();
}

function dotenvFilesFor(projectDir: string): string[] {
  const files: string[] = [];
  let current = projectDir;

  while (true) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) files.unshift(candidate);

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return files;
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
