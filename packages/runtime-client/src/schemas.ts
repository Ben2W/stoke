import { Schema } from "effect";

export class RuntimeClientSchemaError extends Error {
  constructor(readonly cause: unknown) {
    super(String(cause));
    this.name = "RuntimeClientSchemaError";
  }
}

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: RuntimeClientSchemaError };

type RuntimeClientSchema<T> = {
  parse(value: unknown): T;
  safeParse(value: unknown): ParseResult<T>;
};

function runtimeClientSchema<T, I>(schema: Schema.Schema<T, I, never>): RuntimeClientSchema<T> {
  const decode = Schema.decodeUnknownSync(schema);
  return {
    parse(value) {
      try {
        return decode(value);
      } catch (error) {
        throw new RuntimeClientSchemaError(error);
      }
    },
    safeParse(value) {
      try {
        return { success: true, data: decode(value) };
      } catch (error) {
        return { success: false, error: new RuntimeClientSchemaError(error) };
      }
    },
  };
}

export const RuntimeHandleEffectSchema = Schema.Struct({
  projectId: Schema.String,
  runtimeFingerprint: Schema.optional(Schema.String),
  projectDir: Schema.String,
  configPath: Schema.String,
  statePath: Schema.optional(Schema.String),
  globalFragmentRoot: Schema.optional(Schema.String),
  pid: Schema.Int,
  url: Schema.String,
  tokenPath: Schema.String,
  engineVersion: Schema.optional(Schema.String),
  runtimeVersion: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
});

export const RuntimeReadyEffectSchema = Schema.Struct({
  type: Schema.Literal("ready"),
  url: Schema.String,
  token: Schema.optional(Schema.String),
});

export const RuntimeHealthEffectSchema = Schema.Struct({
  ok: Schema.Boolean,
  projectId: Schema.String,
  runtimeFingerprint: Schema.optional(Schema.String),
  projectDir: Schema.optional(Schema.String),
  configPath: Schema.optional(Schema.String),
  statePath: Schema.optional(Schema.String),
  globalFragmentRoot: Schema.optional(Schema.String),
  engineVersion: Schema.optional(Schema.String),
  runtimeVersion: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
});

export const RuntimeMetadataEffectSchema = Schema.Struct({
  apiVersion: Schema.Int,
  engineVersion: Schema.String,
  runtimeVersion: Schema.String,
  protocolHash: Schema.String,
});

export const RuntimeErrorResponseEffectSchema = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
  }),
});

export type RuntimeHandle = Schema.Schema.Type<typeof RuntimeHandleEffectSchema>;
export type RuntimeReady = Schema.Schema.Type<typeof RuntimeReadyEffectSchema>;
export type RuntimeHealth = Schema.Schema.Type<typeof RuntimeHealthEffectSchema>;
export type RuntimeMetadata = Schema.Schema.Type<typeof RuntimeMetadataEffectSchema>;

export const RuntimeHandleSchema: RuntimeClientSchema<RuntimeHandle> = runtimeClientSchema(RuntimeHandleEffectSchema);
export const RuntimeReadySchema: RuntimeClientSchema<RuntimeReady> = runtimeClientSchema(RuntimeReadyEffectSchema);
export const RuntimeHealthSchema: RuntimeClientSchema<RuntimeHealth> = runtimeClientSchema(RuntimeHealthEffectSchema);
export const RuntimeMetadataSchema: RuntimeClientSchema<RuntimeMetadata> = runtimeClientSchema(RuntimeMetadataEffectSchema);
export const RuntimeErrorResponseSchema: RuntimeClientSchema<Schema.Schema.Type<typeof RuntimeErrorResponseEffectSchema>> =
  runtimeClientSchema(RuntimeErrorResponseEffectSchema);
