import { Effect } from "effect";
import {
  RuntimeApiVersionError,
  RuntimeAuthError,
  RuntimeConnectionError,
  RuntimeHttpError,
  type RuntimeClientError,
  isRuntimeClientError,
} from "./errors.ts";

export const SUPPORTED_RUNTIME_API_VERSION = 1;

export function runtimeStreamEffect(
  baseUrl: string,
  token: string,
  path: string,
  onEvent: (event: unknown) => Promise<void> | void,
): Effect.Effect<void, RuntimeClientError> {
  return Effect.tryPromise({
    try: () => runtimeStreamUnsafe(baseUrl, token, path, onEvent),
    catch: (cause) => toRuntimeTransportError(cause, { method: "GET", path }),
  });
}

export function assertSupportedApiVersion(response: Response): void {
  assertSupportedApiVersionHeader(response.headers.get("x-stoke-api-version"));
}

export function assertSupportedApiVersionHeader(version: string | null | undefined): void {
  if (version !== String(SUPPORTED_RUNTIME_API_VERSION)) {
    throw new RuntimeApiVersionError({
      version: version ?? null,
      supportedVersion: SUPPORTED_RUNTIME_API_VERSION,
    });
  }
}

export function toRuntimeTransportError(
  cause: unknown,
  context: { method: string; path: string },
): RuntimeClientError {
  if (isRuntimeClientError(cause)) {
    return cause;
  }
  return new RuntimeConnectionError({
    method: context.method,
    path: context.path,
    cause,
  });
}

async function runtimeStreamUnsafe(
  baseUrl: string,
  token: string,
  path: string,
  onEvent: (event: unknown) => Promise<void> | void,
): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok || !response.body) {
    throw runtimeHttpError("GET", path, response.status);
  }
  assertSupportedApiVersion(response);
  await readSse(response.body, onEvent);
}

function runtimeHttpError(method: string, path: string, status: number, message?: string): RuntimeHttpError | RuntimeAuthError {
  if (status === 401 || status === 403) {
    return new RuntimeAuthError({ method, path, status, message });
  }
  return new RuntimeHttpError({ method, path, status, message });
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
