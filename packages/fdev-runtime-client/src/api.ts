import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "@effect/platform";
import { Schema } from "effect";
import { SUPPORTED_RUNTIME_API_VERSION } from "./http.ts";

const UnknownRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const OptionalString = Schema.optional(Schema.String);

export const RuntimeControlHealthEffectSchema = Schema.Struct({
  ok: Schema.Boolean,
  projectId: Schema.String,
  projectDir: Schema.String,
  configPath: Schema.String,
  statePath: OptionalString,
  engineVersion: Schema.String,
  runtimeVersion: Schema.String,
  expiresAt: Schema.String,
}).annotations({ identifier: "Health" });

export const RuntimeControlMetadataEffectSchema = Schema.Struct({
  apiVersion: Schema.Number,
  engineVersion: Schema.String,
  runtimeVersion: Schema.String,
  protocolHash: Schema.String,
}).annotations({ identifier: "RuntimeMetadata" });

export const RuntimeControlWorkflowSummaryEffectSchema = Schema.Struct({
  name: Schema.String,
  providers: Schema.Array(Schema.String),
  nodes: Schema.Array(Schema.String),
  operations: Schema.Array(Schema.String),
  createsWorkspace: Schema.Boolean,
}).annotations({ identifier: "WorkflowSummary" });

export const RuntimeControlProjectInfoEffectSchema = Schema.Struct({
  projectDir: Schema.String,
  configPath: Schema.String,
  statePath: OptionalString,
  workflow: Schema.optional(RuntimeControlWorkflowSummaryEffectSchema),
  workflows: Schema.Array(RuntimeControlWorkflowSummaryEffectSchema),
}).annotations({ identifier: "ProjectInfo" });

export const RuntimeControlHostMethodRequirementEffectSchema = Schema.Struct({
  id: Schema.String,
  modes: Schema.optional(Schema.Array(Schema.String)),
}).annotations({ identifier: "HostMethodRequirement" });

export const RuntimeControlHostCapabilityRequirementEffectSchema = Schema.Struct({
  id: Schema.String,
  schemaHash: OptionalString,
}).annotations({ identifier: "HostCapabilityRequirement" });

export const RuntimeControlOperationCliEffectSchema = Schema.Struct({
  positionals: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.String,
    index: Schema.Number,
  }))),
  options: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.String,
    flag: Schema.String,
    aliases: Schema.optional(Schema.Array(Schema.String)),
    required: Schema.optional(Schema.Boolean),
    runtime: Schema.optional(Schema.Boolean),
    type: Schema.optional(Schema.Literal("string", "boolean", "number")),
  }))),
}).annotations({ identifier: "RuntimeOperationCli" });

export const RuntimeControlOperationEffectSchema = Schema.Struct({
  id: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  kind: Schema.Literal("command", "workspace-action"),
  source: Schema.Literal("core", "config"),
  title: Schema.String,
  description: Schema.String,
  createsWorkspace: Schema.optional(Schema.Boolean),
  requiredHostMethods: Schema.optional(Schema.Array(RuntimeControlHostMethodRequirementEffectSchema)),
  requiredHostCapabilities: Schema.optional(Schema.Array(RuntimeControlHostCapabilityRequirementEffectSchema)),
  cli: Schema.optional(RuntimeControlOperationCliEffectSchema),
  inputSchema: UnknownRecord,
}).annotations({ identifier: "RuntimeOperation" });

export const RuntimeControlOperationsManifestEffectSchema = Schema.Struct({
  hostMethods: Schema.Struct({
    known: Schema.Array(RuntimeControlHostMethodRequirementEffectSchema),
    requiredByOperations: Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) }),
  }),
  hostCapabilities: Schema.Struct({
    optional: Schema.Array(RuntimeControlHostCapabilityRequirementEffectSchema),
    requiredByOperations: Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) }),
  }),
  operations: Schema.Array(RuntimeControlOperationEffectSchema),
}).annotations({ identifier: "OperationsManifest" });

export const RuntimeControlWorkflowsResponseEffectSchema = Schema.Struct({
  workflows: Schema.Array(RuntimeControlWorkflowSummaryEffectSchema),
}).annotations({ identifier: "WorkflowsResponse" });

export const RuntimeControlWorkspaceEffectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  providerId: Schema.String,
  workflow: Schema.String,
  resourceId: OptionalString,
  snapshotId: OptionalString,
  sourceRef: Schema.Unknown,
  context: UnknownRecord,
  metadata: UnknownRecord,
  data: UnknownRecord,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotations({ identifier: "Workspace" });

export const RuntimeControlWorkspacesResponseEffectSchema = Schema.Struct({
  workspaces: Schema.Array(RuntimeControlWorkspaceEffectSchema),
}).annotations({ identifier: "WorkspacesResponse" });

export const RuntimeControlSnapshotsResponseEffectSchema = Schema.Struct({
  snapshots: Schema.Array(Schema.Unknown),
}).annotations({ identifier: "SnapshotsResponse" });

export const RuntimeControlRunEffectSchema = Schema.Struct({
  runId: Schema.String,
  operation: Schema.String,
  input: Schema.Unknown,
  status: Schema.Literal("running", "completed", "failed"),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  })),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotations({ identifier: "Run" });

export const RuntimeControlRunsResponseEffectSchema = Schema.Struct({
  runs: Schema.Array(RuntimeControlRunEffectSchema),
}).annotations({ identifier: "RunsResponse" });

export const RuntimeControlRunOperationRequestEffectSchema = Schema.Struct({
  operation: Schema.NonEmptyString,
  input: Schema.optional(Schema.Unknown),
}).annotations({ identifier: "RunOperationRequest" });

export const RuntimeControlRunStartedEffectSchema = Schema.Struct({
  runId: Schema.String,
  operation: Schema.String,
  status: Schema.Literal("running", "completed", "failed"),
  eventsUrl: Schema.String,
  sessionUrl: Schema.String,
}).annotations({ identifier: "RunStarted" });

export const RuntimeControlHostResponseEffectSchema = Schema.Union(
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

export const RuntimeControlOkResponseEffectSchema = Schema.Struct({
  ok: Schema.Boolean,
}).annotations({ identifier: "OkResponse" });

export type RuntimeControlHealth = Schema.Schema.Type<typeof RuntimeControlHealthEffectSchema>;
export type RuntimeControlMetadata = Schema.Schema.Type<typeof RuntimeControlMetadataEffectSchema>;
export type RuntimeControlWorkflowSummary = Schema.Schema.Type<typeof RuntimeControlWorkflowSummaryEffectSchema>;
export type RuntimeControlProjectInfo = Schema.Schema.Type<typeof RuntimeControlProjectInfoEffectSchema>;
export type RuntimeControlHostMethodRequirement = Schema.Schema.Type<typeof RuntimeControlHostMethodRequirementEffectSchema>;
export type RuntimeControlHostCapabilityRequirement = Schema.Schema.Type<typeof RuntimeControlHostCapabilityRequirementEffectSchema>;
export type RuntimeControlOperationCli = Schema.Schema.Type<typeof RuntimeControlOperationCliEffectSchema>;
export type RuntimeControlOperation = Schema.Schema.Type<typeof RuntimeControlOperationEffectSchema>;
export type RuntimeControlOperationsManifest = Schema.Schema.Type<typeof RuntimeControlOperationsManifestEffectSchema>;
export type RuntimeControlWorkflowsResponse = Schema.Schema.Type<typeof RuntimeControlWorkflowsResponseEffectSchema>;
export type RuntimeControlWorkspace = Schema.Schema.Type<typeof RuntimeControlWorkspaceEffectSchema>;
export type RuntimeControlWorkspacesResponse = Schema.Schema.Type<typeof RuntimeControlWorkspacesResponseEffectSchema>;
export type RuntimeControlSnapshotsResponse = Schema.Schema.Type<typeof RuntimeControlSnapshotsResponseEffectSchema>;
export type RuntimeControlRunOperationRequest = Schema.Schema.Type<typeof RuntimeControlRunOperationRequestEffectSchema>;
export type RuntimeControlRun = Schema.Schema.Type<typeof RuntimeControlRunEffectSchema>;
export type RuntimeControlRunsResponse = Schema.Schema.Type<typeof RuntimeControlRunsResponseEffectSchema>;
export type RuntimeControlRunStarted = Schema.Schema.Type<typeof RuntimeControlRunStartedEffectSchema>;
export type RuntimeControlHostResponse = Schema.Schema.Type<typeof RuntimeControlHostResponseEffectSchema>;
export type RuntimeControlOkResponse = Schema.Schema.Type<typeof RuntimeControlOkResponseEffectSchema>;

const runId = HttpApiSchema.param("runId", Schema.String);
const requestId = HttpApiSchema.param("requestId", Schema.String);

export const runtimeControlApi = HttpApi.make("fdev-runtime")
  .annotate(OpenApi.Title, "fdev runtime")
  .annotate(OpenApi.Version, String(SUPPORTED_RUNTIME_API_VERSION))
  .add(
    HttpApiGroup.make("control", { topLevel: true })
      .add(HttpApiEndpoint.get("health", "/health").addSuccess(RuntimeControlHealthEffectSchema))
      .add(HttpApiEndpoint.get("openApi", "/openapi.json").addSuccess(Schema.Unknown))
      .add(HttpApiEndpoint.get("runtime", "/runtime").addSuccess(RuntimeControlMetadataEffectSchema))
      .add(HttpApiEndpoint.get("project", "/project").addSuccess(RuntimeControlProjectInfoEffectSchema))
      .add(HttpApiEndpoint.get("operations", "/operations").addSuccess(RuntimeControlOperationsManifestEffectSchema))
      .add(HttpApiEndpoint.get("workflows", "/workflows").addSuccess(RuntimeControlWorkflowsResponseEffectSchema))
      .add(HttpApiEndpoint.get("workspaces", "/workspaces").addSuccess(RuntimeControlWorkspacesResponseEffectSchema))
      .add(HttpApiEndpoint.get("snapshots", "/snapshots").addSuccess(RuntimeControlSnapshotsResponseEffectSchema))
      .add(HttpApiEndpoint.get("runs", "/runs").addSuccess(RuntimeControlRunsResponseEffectSchema))
      .add(HttpApiEndpoint.post("startRun", "/runs")
        .setPayload(RuntimeControlRunOperationRequestEffectSchema)
        .addSuccess(RuntimeControlRunStartedEffectSchema, { status: 202 }))
      .add(HttpApiEndpoint.get("run")`/runs/${runId}`.addSuccess(RuntimeControlRunEffectSchema))
      .add(HttpApiEndpoint.get("runEvents")`/runs/${runId}/events`.addSuccess(Schema.String))
      .add(HttpApiEndpoint.post("hostResponse")`/host-responses/${requestId}`
        .setPayload(RuntimeControlHostResponseEffectSchema)
        .addSuccess(RuntimeControlOkResponseEffectSchema))
      .add(HttpApiEndpoint.post("shutdown", "/shutdown").addSuccess(RuntimeControlOkResponseEffectSchema)),
  );
