import {
  EngineOperationNotFoundError,
  EngineOperationValidationError,
} from "@freestyle-sh/fdev-engine";

export type RuntimeFailureCode =
  | "ENGINE_FAILED"
  | "HOST_REQUEST_FAILED"
  | "OPERATION_NOT_FOUND"
  | "OPERATION_VALIDATION_FAILED"
  | "RUN_CANCELLED";

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

export function runtimeFailureBody(error: unknown): { code: RuntimeFailureCode; message: string } {
  const normalized = normalizeRuntimeRunError(error);
  return {
    code: normalized.code,
    message: normalized.message,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
