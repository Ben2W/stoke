import { z } from "zod";
import type { WorkflowEvent } from "@freestyle-sh/fdev-engine";

export const RUNTIME_API_VERSION = 1;
export const RUNTIME_PROTOCOL_HASH = "sha256:39b194a9bcba74aeb6f0c8570f2eea841be5fa6d3af42a3c4fdd11b38f150e2c";
export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export const RunOperationRequestSchema = z.object({
  operation: z.string().min(1),
  input: z.unknown().optional(),
});

export const HostResponseSchema = z.union([
  z.object({
    result: z.unknown().optional(),
  }),
  z.object({
    error: z.object({
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  }),
]);

export const HostCommandRequestSchema = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
  stdin: z.string().nullable().optional(),
  reason: z.string().optional(),
  presentation: z.object({
    visible: z.boolean().optional(),
    label: z.string().optional(),
  }).optional(),
});

export const HostCommandResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export type RunOperationRequest = z.infer<typeof RunOperationRequestSchema>;
export type HostResponse = z.infer<typeof HostResponseSchema>;
export type HostCommandRequest = z.infer<typeof HostCommandRequestSchema>;
export type HostCommandResult = z.infer<typeof HostCommandResultSchema>;

export type HostRequestEvent = {
  type: "host.request";
  requestId: string;
  method: string;
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
  error: { message: string };
};

export type RuntimeEvent = WorkflowEvent | HostRequestEvent | RunCompletedEvent | RunFailedEvent;

export type JsonSchema = Record<string, unknown>;

export type RuntimeOperation = {
  id: string;
  kind: "command";
  title: string;
  description: string;
  inputSchema: JsonSchema;
};

export function objectSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties,
  };
}
