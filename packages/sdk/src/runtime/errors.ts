import {
  EngineOperationNotFoundError,
  EngineOperationValidationError,
} from "@rigkit/engine";

export type RuntimeFailureCode =
  | "ENGINE_FAILED"
  | "HOST_REQUEST_FAILED"
  | "OPERATION_NOT_FOUND"
  | "OPERATION_VALIDATION_FAILED"
  | "RUN_CANCELLED";

export type RuntimeFailureBody = {
  code: RuntimeFailureCode;
  message: string;
  details?: Record<string, unknown>;
};

export class RuntimeOperationValidationError extends Error {
  readonly code = "OPERATION_VALIDATION_FAILED" as const;
  readonly operation: string;

  constructor(input: { operation: string; cause: unknown }) {
    super(`Invalid input for operation ${input.operation}: ${String(input.cause)}`, { cause: input.cause });
    this.name = "RuntimeOperationValidationError";
    this.operation = input.operation;
  }
}

export class RuntimeOperationNotFoundError extends Error {
  readonly code = "OPERATION_NOT_FOUND" as const;
  readonly operation: string;

  constructor(operation: string) {
    super(`Unknown operation ${operation}`);
    this.name = "RuntimeOperationNotFoundError";
    this.operation = operation;
  }
}

export class RuntimeHostRequestError extends Error {
  readonly code = "HOST_REQUEST_FAILED" as const;
  readonly requestId?: string;
  readonly method?: string;
  readonly hostCode?: string;

  constructor(input: {
    message?: string;
    requestId?: string;
    method?: string;
    hostCode?: string;
    cause?: unknown;
  }) {
    super(input.message ?? "Host request failed", { cause: input.cause });
    this.name = "RuntimeHostRequestError";
    this.requestId = input.requestId;
    this.method = input.method;
    this.hostCode = input.hostCode;
  }
}

export class RuntimeEngineError extends Error {
  readonly code = "ENGINE_FAILED" as const;

  constructor(input: { message?: string; cause: unknown }) {
    super(input.message ?? errorMessage(input.cause), { cause: input.cause });
    this.name = "RuntimeEngineError";
  }
}

export class RuntimeRunCancelledError extends Error {
  readonly code = "RUN_CANCELLED" as const;

  constructor() {
    super("Run cancelled by host");
    this.name = "RuntimeRunCancelledError";
  }
}

export type RuntimeRunError =
  | RuntimeEngineError
  | RuntimeHostRequestError
  | RuntimeOperationNotFoundError
  | RuntimeOperationValidationError
  | RuntimeRunCancelledError;

export function isRuntimeRunError(error: unknown): error is RuntimeRunError {
  return error instanceof RuntimeEngineError
    || error instanceof RuntimeHostRequestError
    || error instanceof RuntimeOperationNotFoundError
    || error instanceof RuntimeOperationValidationError
    || error instanceof RuntimeRunCancelledError;
}

export function normalizeRuntimeRunError(error: unknown): RuntimeRunError {
  if (isRuntimeRunError(error)) return error;
  if (error instanceof EngineOperationNotFoundError) return new RuntimeOperationNotFoundError(error.operation);
  if (error instanceof EngineOperationValidationError) {
    return new RuntimeOperationValidationError({ operation: error.operation, cause: error });
  }
  return new RuntimeEngineError({ cause: error });
}

export function runtimeFailureBody(error: unknown): RuntimeFailureBody {
  const normalized = normalizeRuntimeRunError(error);
  const details = failureDetails(normalized);
  return {
    code: normalized.code,
    message: normalized.message,
    ...(details ? { details } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MAX_DETAIL_DEPTH = 5;
const MAX_DETAIL_KEYS = 60;
const MAX_DETAIL_ITEMS = 40;
const MAX_DETAIL_STRING = 8_000;
const SENSITIVE_DETAIL_KEY = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credential|cookie/i;

function failureDetails(error: RuntimeRunError): Record<string, unknown> | undefined {
  const details = errorDetailValue(error, new WeakSet(), 0);
  return isRecord(details) ? details : undefined;
}

function errorDetailValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DETAIL_DEPTH) return "[Max depth exceeded]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return clipDetailString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    const detail: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    if (value.stack) detail.stack = clipDetailString(value.stack);

    for (const key of [
      "code",
      "status",
      "statusCode",
      "requestId",
      "method",
      "path",
      "hostCode",
      "operation",
      "reason",
      "body",
    ]) {
      const field = (value as unknown as Record<string, unknown>)[key];
      if (field !== undefined) detail[key] = redactOrDetail(key, field, seen, depth + 1);
    }

    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) detail.cause = errorDetailValue(cause, seen, depth + 1);
    return detail;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_DETAIL_ITEMS).map((item) => errorDetailValue(item, seen, depth + 1));
    if (value.length > MAX_DETAIL_ITEMS) items.push(`[${value.length - MAX_DETAIL_ITEMS} more items]`);
    return items;
  }

  if (!isRecord(value)) return String(value);

  const detail: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_DETAIL_KEYS);
  for (const [key, field] of entries) {
    detail[key] = redactOrDetail(key, field, seen, depth + 1);
  }
  const extra = Object.keys(value).length - entries.length;
  if (extra > 0) detail.__truncated = `${extra} more keys`;
  return detail;
}

function redactOrDetail(key: string, value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (SENSITIVE_DETAIL_KEY.test(key)) return "[redacted]";
  return errorDetailValue(value, seen, depth);
}

function clipDetailString(value: string): string {
  return value.length > MAX_DETAIL_STRING
    ? `${value.slice(0, MAX_DETAIL_STRING)}... [truncated]`
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
