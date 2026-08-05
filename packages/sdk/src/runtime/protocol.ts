import { Schema } from "effect";
import type { WorkflowEvent } from "@stoke/engine";

export const RUNTIME_API_VERSION = 1;
export const RUNTIME_PROTOCOL_HASH = "sha256:ac8d4a503b56c15b333ea51f57ab1f6fca776bea93f498120b10ab601cc0960a";
export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export class RuntimeProtocolSchemaError extends Error {
  constructor(readonly cause: unknown) {
    super(String(cause));
    this.name = "RuntimeProtocolSchemaError";
  }
}

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: RuntimeProtocolSchemaError };

type RuntimeSchema<T> = {
  parse(value: unknown): T;
  safeParse(value: unknown): ParseResult<T>;
};

function runtimeSchema<T, I>(schema: Schema.Schema<T, I, never>): RuntimeSchema<T> {
  const decode = Schema.decodeUnknownSync(schema);
  return {
    parse(value) {
      try {
        return decode(value);
      } catch (error) {
        throw new RuntimeProtocolSchemaError(error);
      }
    },
    safeParse(value) {
      try {
        return { success: true, data: decode(value) };
      } catch (error) {
        return { success: false, error: new RuntimeProtocolSchemaError(error) };
      }
    },
  };
}

export const RunOperationRequestEffectSchema = Schema.Struct({
  operation: Schema.NonEmptyString,
  input: Schema.optional(Schema.Unknown),
}).annotations({ identifier: "RunOperationRequest" });

export const HostResponseEffectSchema = Schema.Union(
  Schema.Struct({
    error: Schema.Struct({
      code: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
    }),
  }),
  Schema.Struct({
    result: Schema.optional(Schema.Unknown),
  }),
).annotations({ identifier: "HostResponse" });

export const HostCommandRequestEffectSchema = Schema.Struct({
  argv: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
  cwd: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.UndefinedOr(Schema.String) })),
  stdin: Schema.optional(Schema.NullOr(Schema.String)),
  mode: Schema.optional(Schema.Literal("capture", "interactive")),
  reason: Schema.optional(Schema.String),
  presentation: Schema.optional(Schema.Struct({
    visible: Schema.optional(Schema.Boolean),
    label: Schema.optional(Schema.String),
  })),
}).annotations({ identifier: "HostCommandRequest" });

export const HostCommandResultEffectSchema = Schema.Struct({
  exitCode: Schema.Int,
  stdout: Schema.NullOr(Schema.String),
  stderr: Schema.NullOr(Schema.String),
}).annotations({ identifier: "HostCommandResult" });

export type RunOperationRequest = Schema.Schema.Type<typeof RunOperationRequestEffectSchema>;
export type HostResponse = Schema.Schema.Type<typeof HostResponseEffectSchema>;
export type HostCommandRequest = Schema.Schema.Type<typeof HostCommandRequestEffectSchema>;
export type HostCommandResult = Schema.Schema.Type<typeof HostCommandResultEffectSchema>;

export const RunOperationRequestSchema: RuntimeSchema<RunOperationRequest> = runtimeSchema(RunOperationRequestEffectSchema);
export const HostResponseSchema: RuntimeSchema<HostResponse> = runtimeSchema(HostResponseEffectSchema);
export const HostCommandRequestSchema: RuntimeSchema<HostCommandRequest> = runtimeSchema(HostCommandRequestEffectSchema);
export const HostCommandResultSchema: RuntimeSchema<HostCommandResult> = runtimeSchema(HostCommandResultEffectSchema);

export type HostRequestEvent = {
  type: "host.request";
  requestId: string;
  id: string;
  method: string;
  params: unknown;
};

export type HostCapabilityRequestEvent = {
  type: "host.capability.request";
  requestId: string;
  id: string;
  nodePath?: string;
  capability: string;
  params: unknown;
};

export type RunCompletedEvent = {
  type: "run.completed";
  runId: string;
  result: unknown;
};

export type RunFailedEvent = {
  type: "run.failed";
  runId: string;
  error: { code?: string; message: string; details?: Record<string, unknown> };
};

export type RuntimeEvent =
  | WorkflowEvent
  | HostRequestEvent
  | HostCapabilityRequestEvent
  | RunCompletedEvent
  | RunFailedEvent;

export type JsonSchema = Record<string, unknown>;

export type RuntimeOperationSource = "core" | "config";

export type RuntimeOperationKind = "command" | "workspace-action";

export type RuntimeOperationCliPosition = {
  name: string;
  index: number;
};

export type RuntimeOperationCliOption = {
  name: string;
  flag: string;
  aliases?: string[];
  required?: boolean;
  runtime?: boolean;
  type?: "string" | "boolean" | "number";
};

export type RuntimeOperationCli = {
  positionals?: RuntimeOperationCliPosition[];
  options?: RuntimeOperationCliOption[];
};

export type RuntimeOperation = {
  workflow: string;
  id: string;
  aliases?: string[];
  kind: RuntimeOperationKind;
  source: RuntimeOperationSource;
  title: string;
  description: string;
  createsWorkspace?: boolean;
  cli?: RuntimeOperationCli;
  inputSchema: JsonSchema;
  requiredCapabilities: Array<{ id: string; schemaHash?: string }>;
};

export type RuntimeOperationsManifest = {
  operations: RuntimeOperation[];
  workspaceOperations: RuntimeOperation[];
};

export function objectSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties,
  };
}
