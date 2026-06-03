import {
  Bash,
  InMemoryFs,
  type FileContent,
  type IFileSystem,
  type InitialFiles,
} from "just-bash/browser";

import type { DocsVirtualFileSystemPayload } from "../lib/docs-vfs";
import { docsWebPath } from "../lib/docs-paths";
import { devAssetOrigin, fetchAssetUrl } from "./dev-assets";

const BASH_PATH = docsWebPath("/bash");
const VFS_JSON_PATH = docsWebPath("/api/vfs.json");
const EXECUTION_TIMEOUT_MS = 5_000;
const MAX_COMMAND_BYTES = 64_000;
const MAX_OUTPUT_BYTES = 256_000;
const ALLOWED_CONTENT_TYPES = new Set([
  "",
  "text/plain",
  "application/x-www-form-urlencoded",
  "application/octet-stream",
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type BashRequestInput = {
  command: string;
  format: "json" | "text";
};

type BashExecutionResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut?: boolean;
  infrastructureError?: boolean;
};

let docsPayloadPromise: Promise<DocsVirtualFileSystemPayload> | undefined;

export function isBashRequest(url: URL) {
  return url.pathname === BASH_PATH;
}

export async function docsBashResponse(
  request: Request,
  env: Env,
  url: URL,
) {
  if (request.method === "GET" || request.method === "HEAD") {
    if (hasLegacyCommandQuery(url)) {
      return errorResponse(
        request,
        "query_param_no_longer_supported",
        400,
        {},
        "query param is no longer supported; send the command in the POST body.",
      );
    }

    return textResponse(renderBashUsage(request, env, url), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "method_not_allowed", 405, {
      Allow: "GET, HEAD, POST",
    });
  }

  const format = requestedFormat(request);
  const contentType = normalizedContentType(request);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    const acceptedContentTypes = [...ALLOWED_CONTENT_TYPES].filter(Boolean);
    return errorResponse(
      request,
      "unsupported_content_type",
      415,
      {},
      `unsupported content type "${contentType}"; accepted content types: ${acceptedContentTypes.join(", ")}`,
      { acceptedContentTypes },
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_COMMAND_BYTES) {
    return errorResponse(request, "command_too_large", 413);
  }

  let commandBytes: Uint8Array;
  try {
    commandBytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return errorResponse(request, "body_unreadable", 400);
  }

  if (commandBytes.byteLength > MAX_COMMAND_BYTES) {
    return errorResponse(request, "command_too_large", 413);
  }

  const commandHash = await sha256Bytes(commandBytes);

  let command: string;
  try {
    command = decoder.decode(commandBytes);
  } catch {
    return errorResponse(request, "command_must_be_utf8", 400, {
      "X-Freestyle-Command-SHA256": commandHash,
    });
  }

  if (command.trim().length === 0) {
    return errorResponse(
      request,
      "empty_command",
      400,
      {
        "X-Freestyle-Command-SHA256": commandHash,
      },
      "empty command; send a shell command in the request body.",
    );
  }

  let payload: DocsVirtualFileSystemPayload;
  try {
    payload = await getDocsPayload(env, url);
  } catch {
    return errorResponse(request, "docs_unavailable", 500, {
      "Cache-Control": "no-store",
      "X-Freestyle-Command-SHA256": commandHash,
    });
  }

  const docsVersion = docsVersionForPayload(payload, env);
  const result = await runDocsBash(payload, {
    command,
    format,
  });
  const response = bashResultResponse(result, format, {
    commandHash,
    docsVersion,
  });

  return response;
}

async function getDocsPayload(env: Env, requestUrl: URL) {
  if (devAssetOrigin(env)) {
    return loadDocsPayload(env, requestUrl);
  }

  docsPayloadPromise ??= loadDocsPayload(env, requestUrl);

  try {
    return await docsPayloadPromise;
  } catch (error) {
    docsPayloadPromise = undefined;
    throw error;
  }
}

async function loadDocsPayload(
  env: Env,
  requestUrl: URL,
): Promise<DocsVirtualFileSystemPayload> {
  const vfsUrl = new URL(VFS_JSON_PATH, requestUrl);
  const response = await fetchAssetUrl(env, vfsUrl);

  if (!response.ok) {
    throw new Error(`Docs VFS payload load failed with ${response.status}`);
  }

  return (await response.json()) as DocsVirtualFileSystemPayload;
}

async function runDocsBash(
  payload: DocsVirtualFileSystemPayload,
  input: BashRequestInput,
): Promise<BashExecutionResult> {
  const startedAt = performance.now();
  const bash = new Bash({
    fs: readOnlyFileSystem(payload.files as InitialFiles),
    cwd: "/",
    env: {
      HOME: "/",
      PAGER: "cat",
      TERM: "dumb",
    },
    executionLimits: {
      maxCommandCount: 2_000,
      maxLoopIterations: 2_000,
      maxOutputSize: MAX_OUTPUT_BYTES * 2,
      maxStringLength: 2_000_000,
    },
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);

  try {
    const result = await bash.exec(input.command, {
      cwd: "/",
      rawScript: true,
      stdin: "",
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      return timeoutResult(input.command, startedAt);
    }

    const stdout = truncateUtf8(result.stdout, MAX_OUTPUT_BYTES);
    const stderr = truncateUtf8(result.stderr, MAX_OUTPUT_BYTES);
    return {
      command: input.command,
      stdout: stdout.value,
      stderr: stderr.value,
      exitCode: result.exitCode,
      durationMs: Math.round(performance.now() - startedAt),
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const message = error instanceof Error ? error.message : String(error);
    const readOnlyWrite = message.includes("EROFS: read-only file system");
    if (timedOut) {
      return timeoutResult(input.command, startedAt);
    }

    return {
      command: input.command,
      stdout: "",
      stderr: `bash: ${message}\n`,
      exitCode: readOnlyWrite ? 1 : 2,
      durationMs: Math.round(performance.now() - startedAt),
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      infrastructureError: !readOnlyWrite,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function timeoutResult(command: string, startedAt: number): BashExecutionResult {
  return {
    command,
    stdout: "",
    stderr: "bash: execution timed out\n",
    exitCode: 124,
    durationMs: Math.round(performance.now() - startedAt),
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: true,
  };
}

function requestedFormat(request: Request): "json" | "text" {
  const accept = request.headers.get("accept") ?? "";
  if (accept.toLowerCase().includes("application/json")) return "json";
  return "text";
}

function hasLegacyCommandQuery(url: URL) {
  return ["query", "q", "cmd", "command"].some((name) =>
    url.searchParams.has(name),
  );
}

function renderBashUsage(request: Request, env: Env, url: URL) {
  const baseUrl = `${requestOrigin(request, env, url)}${BASH_PATH}`;
  return [
    "Rigkit Docs Bash",
    "",
    "Run one-shot just-bash commands against the Rigkit docs and source virtual filesystem.",
    "Pass a shell command in the request body.",
    "Each request is stateless and starts in a fresh read-only virtual filesystem.",
    "",
    "Examples:",
    `  curl ${baseUrl} --data-binary 'ls /docs'`,
    `  curl ${baseUrl} --data-binary 'ls /rigkit'`,
    `  curl ${baseUrl} --data-binary 'cat /docs/guides/quickstart.md'`,
    `  curl ${baseUrl} --data-binary 'cat /rigkit/package.json'`,
    `  curl ${baseUrl} --data-binary 'grep -Rni "workspace" /docs | head -20'`,
    `  curl ${baseUrl} --data-binary 'grep -Rni "createDocsVirtualFiles" /rigkit/apps/docs/src | head -20'`,
    `  curl ${baseUrl} --data-binary 'cat /docs/guides/quickstart.md | grep -i "rigkit"'`,
    `  curl ${baseUrl} --data-binary 'cat /api/docs.json | jq ".docs[].path"'`,
    `  curl ${baseUrl} -H 'Accept: application/json' --data-binary 'pwd'`,
    "",
    "Response:",
    "  Plain text by default.",
    "  Add Accept: application/json for command, stdout, stderr, exitCode, and durationMs.",
    "",
    "Limits:",
    `  command size        ${MAX_COMMAND_BYTES} bytes`,
    `  duration            ${EXECUTION_TIMEOUT_MS}ms`,
    `  stdout/stderr       ${MAX_OUTPUT_BYTES} bytes each`,
    "  stdin               empty; pass file paths or pipe content between commands",
    "",
    "Filesystem:",
    "  /docs              Markdown docs",
    "  /rigkit            Rigkit source code snapshot",
    "  /README.md         Short orientation",
    "  /llms.txt          LLM index",
    "  /llms-full.txt     Full docs context",
    "  /api/docs.json     Machine-readable docs bundle",
    "",
    "stdin:",
    "  Commands run without interactive stdin. For example, `grep freestyle` reads",
    "  empty stdin and returns no matches. Pass paths or pipe content into commands.",
    "",
  ].join("\n");
}

function requestOrigin(request: Request, env: Env, url: URL) {
  const configuredOrigin = env.DEV_WORKER_ORIGIN?.trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  const host = request.headers.get("host") ?? url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol;
  return `${protocol}//${host}`;
}

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  addVaryAccept(headers);
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

function textResponse(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "text/plain; charset=utf-8");
  addVaryAccept(headers);
  return new Response(body, {
    ...init,
    headers,
  });
}

function addVaryAccept(headers: Headers) {
  const vary = headers.get("Vary");
  if (!vary) {
    headers.set("Vary", "Accept");
    return;
  }

  const values = vary.split(",").map((value) => value.trim().toLowerCase());
  if (!values.includes("accept")) {
    headers.set("Vary", `${vary}, Accept`);
  }
}

function errorResponse(
  request: Request,
  error: string,
  status: number,
  headers: HeadersInit = {},
  message?: string,
  details: Record<string, unknown> = {},
) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", responseHeaders.get("Cache-Control") ?? "no-store");

  if (requestedFormat(request) === "json") {
    return jsonResponse(
      {
        error,
        ...(message ? { message } : {}),
        ...details,
      },
      { status, headers: responseHeaders },
    );
  }

  return textResponse(`${message ?? error}\n`, {
    status,
    headers: responseHeaders,
  });
}

function bashResultResponse(
  result: BashExecutionResult,
  format: "json" | "text",
  {
    commandHash,
    docsVersion,
  }: {
    commandHash: string;
    docsVersion: string;
  },
) {
  const status = result.timedOut ? 504 : result.infrastructureError ? 500 : 200;
  const headers = bashHeaders({
    commandHash,
    docsVersion,
    exitCode: result.exitCode,
  });

  if (result.stdoutTruncated) {
    headers.set("X-Freestyle-Bash-Stdout-Truncated", "1");
  }
  if (result.stderrTruncated) {
    headers.set("X-Freestyle-Bash-Stderr-Truncated", "1");
  }

  if (format === "json") {
    return jsonResponse(
      {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        timedOut: result.timedOut === true,
      },
      { status, headers },
    );
  }

  return textResponse(result.stdout + result.stderr, {
    status,
    headers,
  });
}

function bashHeaders({
  commandHash,
  docsVersion,
  exitCode,
}: {
  commandHash: string;
  docsVersion: string;
  exitCode?: number;
}) {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Freestyle-Command-SHA256", commandHash);
  headers.set("X-Freestyle-Docs-Version", docsVersion);
  if (exitCode !== undefined) {
    headers.set("X-Freestyle-Bash-Exit-Code", String(exitCode));
  }
  return headers;
}

function docsVersionForPayload(payload: DocsVirtualFileSystemPayload, env?: Env) {
  return payload.meta?.generatedAt ?? env?.CACHE_VERSION ?? "unknown";
}

function normalizedContentType(request: Request) {
  return (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

async function sha256Bytes(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function truncateUtf8(value: string, maxBytes: number) {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) {
    return { value, truncated: false };
  }

  return {
    value: `${new TextDecoder().decode(bytes.slice(0, maxBytes))}\n[bash output truncated]\n`,
    truncated: true,
  };
}

function readOnlyFileSystem(files: InitialFiles): IFileSystem {
  const fs = new InMemoryFs(files);
  const readonlyError = (operation: string, path: string) =>
    new Error(`EROFS: read-only file system, ${operation} '${path}'`);

  return {
    readFile: fs.readFile.bind(fs),
    readFileBytes: fs.readFileBytes.bind(fs),
    readFileBuffer: fs.readFileBuffer.bind(fs),
    exists: fs.exists.bind(fs),
    stat: fs.stat.bind(fs),
    lstat: fs.lstat.bind(fs),
    readdir: fs.readdir.bind(fs),
    readdirWithFileTypes: fs.readdirWithFileTypes.bind(fs),
    getAllPaths: fs.getAllPaths.bind(fs),
    resolvePath: fs.resolvePath.bind(fs),
    readlink: fs.readlink.bind(fs),
    realpath: fs.realpath.bind(fs),
    writeFile: async (path: string, _content: FileContent) => {
      throw readonlyError("write", path);
    },
    appendFile: async (path: string, _content: FileContent) => {
      throw readonlyError("append", path);
    },
    mkdir: async (path: string) => {
      throw readonlyError("mkdir", path);
    },
    rm: async (path: string) => {
      throw readonlyError("rm", path);
    },
    cp: async (_src: string, dest: string) => {
      throw readonlyError("cp", dest);
    },
    mv: async (_src: string, dest: string) => {
      throw readonlyError("mv", dest);
    },
    chmod: async (path: string) => {
      throw readonlyError("chmod", path);
    },
    symlink: async (_target: string, linkPath: string) => {
      throw readonlyError("symlink", linkPath);
    },
    link: async (_existingPath: string, newPath: string) => {
      throw readonlyError("link", newPath);
    },
    utimes: async (path: string) => {
      throw readonlyError("utimes", path);
    },
  };
}
