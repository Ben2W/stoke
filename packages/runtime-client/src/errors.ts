export type RuntimeStartupErrorReason =
  | "missing-runtime"
  | "lock-timeout"
  | "startup-timeout"
  | "exited-before-ready"
  | "invalid-ready-output"
  | "unhealthy-after-start";

export class RuntimeStartupError extends Error {
  readonly reason: RuntimeStartupErrorReason;
  readonly projectDir?: string;
  readonly path?: string;

  constructor(input: {
    reason: RuntimeStartupErrorReason;
    message: string;
    projectDir?: string;
    path?: string;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "RuntimeStartupError";
    this.reason = input.reason;
    this.projectDir = input.projectDir;
    this.path = input.path;
  }
}

export class RuntimeApiVersionError extends Error {
  readonly version: string | null;
  readonly supportedVersion: number;

  constructor(input: { version: string | null; supportedVersion: number }) {
    super(
      input.version
        ? `Unsupported Stoke runtime API version ${input.version}; this host supports ${input.supportedVersion}`
        : `Runtime did not report x-rigkit-api-version; this host requires ${input.supportedVersion}`,
    );
    this.name = "RuntimeApiVersionError";
    this.version = input.version;
    this.supportedVersion = input.supportedVersion;
  }
}

export class RuntimeAuthError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(input: { status: number; method: string; path: string; message?: string }) {
    super(input.message ?? `${input.method} ${input.path} failed with authentication status ${input.status}`);
    this.name = "RuntimeAuthError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
  }
}

export class RuntimeHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(input: { status: number; method: string; path: string; message?: string; cause?: unknown }) {
    super(input.message ?? `${input.method} ${input.path} failed with ${input.status}`, { cause: input.cause });
    this.name = "RuntimeHttpError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
  }
}

export class RuntimeConnectionError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(input: { method: string; path: string; message?: string; cause?: unknown }) {
    super(input.message ?? `${input.method} ${input.path} failed before the runtime responded`, { cause: input.cause });
    this.name = "RuntimeConnectionError";
    this.method = input.method;
    this.path = input.path;
  }
}

export class RuntimeProtocolError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(input: { method: string; path: string; message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = "RuntimeProtocolError";
    this.method = input.method;
    this.path = input.path;
  }
}

export class RuntimeSessionError extends Error {
  readonly url: string;

  constructor(input: { url: string; message?: string; cause?: unknown }) {
    super(input.message ?? `WebSocket session failed for ${input.url}`, { cause: input.cause });
    this.name = "RuntimeSessionError";
    this.url = input.url;
  }
}

export type RuntimeClientError =
  | RuntimeStartupError
  | RuntimeApiVersionError
  | RuntimeAuthError
  | RuntimeHttpError
  | RuntimeConnectionError
  | RuntimeProtocolError
  | RuntimeSessionError;

export function isRuntimeClientError(error: unknown): error is RuntimeClientError {
  return error instanceof RuntimeStartupError
    || error instanceof RuntimeApiVersionError
    || error instanceof RuntimeAuthError
    || error instanceof RuntimeHttpError
    || error instanceof RuntimeConnectionError
    || error instanceof RuntimeProtocolError
    || error instanceof RuntimeSessionError;
}
