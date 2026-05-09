import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Readable } from "node:stream";
import {
  RuntimeErrorResponseSchema,
  RuntimeHandleSchema,
  RuntimeHealthSchema,
  RuntimeReadySchema,
  type RuntimeHandle,
} from "./schemas.ts";

export type RuntimeProjectOptions = {
  projectDir: string;
  configPath: string;
  statePath?: string;
};

export type RuntimeClient = {
  handle: RuntimeHandle;
  paths: RuntimePaths;
  token: string;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  stream(path: string, onEvent: (event: unknown) => Promise<void> | void): Promise<void>;
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

export async function getOrStartRuntime(options: GetOrStartRuntimeOptions): Promise<RuntimeClient> {
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
  if (!started) throw new Error(`fdev runtime did not become healthy for ${projectDir}`);
  return started;
}

export function projectIdFor(options: RuntimeProjectOptions): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(JSON.stringify({
    projectDir: resolve(options.projectDir),
    configPath: resolve(options.configPath),
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
    const response = await fetch(`${handle.url}/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`health returned ${response.status}`);
    const body = RuntimeHealthSchema.parse(await response.json());
    if (body.projectId !== projectId) throw new Error(`runtime project mismatch`);
    return createClient(handle, paths, token);
  } catch {
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

  const proc = spawn(runtimeBin, args, {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });

  const line = await readReadyLine(proc, input.paths);
  const ready = RuntimeReadySchema.parse(JSON.parse(line));
  if (ready.token && ready.token !== token) {
    writeFileSync(input.paths.tokenPath, `${ready.token}\n`);
  }
  proc.stdout.destroy();
  proc.unref();
}

function createClient(handle: RuntimeHandle, paths: RuntimePaths, token: string): RuntimeClient {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${handle.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const error = RuntimeErrorResponseSchema.safeParse(parsed);
      throw new Error(error.success ? error.data.error.message : `${method} ${path} failed with ${response.status}`);
    }
    return parsed as T;
  };

  return {
    handle,
    paths,
    token,
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    async stream(path, onEvent) {
      const response = await fetch(`${handle.url}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok || !response.body) {
        throw new Error(`GET ${path} failed with ${response.status}`);
      }
      await readSse(response.body, onEvent);
    },
  };
}

async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: unknown) => Promise<void> | void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const index = buffer.indexOf("\n\n");
      if (index < 0) break;
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = raw.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) await onEvent(JSON.parse(data));
    }
  }
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
      await Bun.sleep(50);
    }
  }
  throw new Error(`Timed out waiting for fdev runtime lock ${path}`);
}

function resolveRuntimeBin(projectDir: string): string {
  const local = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "fdev-runtime.cmd" : "fdev-runtime");
  if (existsSync(local)) return local;
  throw new Error(
    [
      `No project-local fdev runtime found at ${local}.`,
      `Install project dependencies so @freestyle-sh/fdev-runtime provides the fdev-runtime binary.`,
    ].join("\n"),
  );
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
  const token = `fdev_${crypto.randomUUID().replaceAll("-", "")}`;
  writeFileSync(path, `${token}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms without chmod support.
  }
  return token;
}

function readReadyLine(proc: ChildProcessByStdio<null, Readable, null>, paths: RuntimePaths): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`Timed out waiting for fdev runtime to start`));
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
      fail(new Error(`fdev runtime exited before ready`));
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      if (code === 0) return;
      removeStale(paths);
      fail(new Error(`fdev runtime exited before ready (${signal ?? `exit ${code}`})`));
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
