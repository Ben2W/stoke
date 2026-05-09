import { z } from "zod";

export const RuntimeHandleSchema = z.object({
  projectId: z.string(),
  projectDir: z.string(),
  configPath: z.string(),
  pid: z.number().int(),
  url: z.string(),
  tokenPath: z.string(),
  engineVersion: z.string().optional(),
  runtimeVersion: z.string().optional(),
  startedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

export const RuntimeReadySchema = z.object({
  type: z.literal("ready"),
  url: z.string(),
  token: z.string().optional(),
});

export const RuntimeHealthSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  projectDir: z.string().optional(),
  configPath: z.string().optional(),
  engineVersion: z.string().optional(),
  runtimeVersion: z.string().optional(),
  expiresAt: z.string().optional(),
});

export const RuntimeMetadataSchema = z.object({
  apiVersion: z.number().int(),
  engineVersion: z.string(),
  runtimeVersion: z.string(),
  protocolHash: z.string(),
});

export const RuntimeErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
  }),
});

export type RuntimeHandle = z.infer<typeof RuntimeHandleSchema>;
export type RuntimeReady = z.infer<typeof RuntimeReadySchema>;
export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;
export type RuntimeMetadata = z.infer<typeof RuntimeMetadataSchema>;
