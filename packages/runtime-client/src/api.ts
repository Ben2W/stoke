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
  runtimeFingerprint: OptionalString,
  projectDir: Schema.String,
  configPath: Schema.String,
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
  lastAppliedAt: Schema.optional(Schema.String),
  lastAppliedCachedNodeCount: Schema.optional(Schema.Number),
  lastAppliedNodeCount: Schema.optional(Schema.Number),
}).annotations({ identifier: "WorkflowSummary" });

export const RuntimeControlProjectInfoEffectSchema = Schema.Struct({
  projectDir: Schema.String,
  configPath: Schema.String,
  workflows: Schema.Array(RuntimeControlWorkflowSummaryEffectSchema),
}).annotations({ identifier: "ProjectInfo" });

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
  workflow: Schema.String,
  id: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  kind: Schema.Literal("command", "workspace-action"),
  source: Schema.Literal("core", "config"),
  title: Schema.String,
  description: Schema.String,
  createsWorkspace: Schema.optional(Schema.Boolean),
  cli: Schema.optional(RuntimeControlOperationCliEffectSchema),
  inputSchema: UnknownRecord,
  requiredCapabilities: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.String,
    schemaHash: Schema.optional(Schema.String),
  }))),
}).annotations({ identifier: "RuntimeOperation" });

export const RuntimeControlOperationsManifestEffectSchema = Schema.Struct({
  operations: Schema.Array(RuntimeControlOperationEffectSchema),
  workspaceOperations: Schema.Array(RuntimeControlOperationEffectSchema),
}).annotations({ identifier: "OperationsManifest" });

export const RuntimeControlWorkflowsResponseEffectSchema = Schema.Struct({
  workflows: Schema.Array(RuntimeControlWorkflowSummaryEffectSchema),
}).annotations({ identifier: "WorkflowsResponse" });

export const RuntimeControlWorkspaceEffectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  workflow: Schema.String,
  ctx: UnknownRecord,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotations({ identifier: "Workspace" });

export const RuntimeControlWorkspacesResponseEffectSchema = Schema.Struct({
  workspaces: Schema.Array(RuntimeControlWorkspaceEffectSchema),
}).annotations({ identifier: "WorkspacesResponse" });

export const RuntimeControlSnapshotsResponseEffectSchema = Schema.Struct({
  snapshots: Schema.Array(Schema.Unknown),
}).annotations({ identifier: "SnapshotsResponse" });

export const RuntimeControlCacheEntryEffectSchema = Schema.Struct({
  scope: Schema.Literal("local", "global"),
  workflow: Schema.String,
  nodePath: Schema.String,
  displayPath: Schema.optional(Schema.String),
  planIndex: Schema.optional(Schema.Number),
  nodeName: Schema.String,
  nodeKind: Schema.String,
  runId: Schema.String,
  invalidated: Schema.Boolean,
  createdAt: Schema.String,
  fragmentHash: Schema.optional(Schema.String),
}).annotations({ identifier: "CacheEntry" });

export const RuntimeControlCacheResponseEffectSchema = Schema.Struct({
  entries: Schema.Array(RuntimeControlCacheEntryEffectSchema),
}).annotations({ identifier: "CacheResponse" });

export const RuntimeControlCacheRequestEffectSchema = Schema.Struct({
  workflow: Schema.String,
}).annotations({ identifier: "CacheRequest" });

export const RuntimeControlCacheClearRequestEffectSchema = Schema.Struct({
  workflow: Schema.String,
  scope: Schema.optional(Schema.Literal("local", "global", "all")),
}).annotations({ identifier: "CacheClearRequest" });

export const RuntimeControlCacheClearResponseEffectSchema = Schema.Struct({
  ok: Schema.Boolean,
  deleted: Schema.Number,
}).annotations({ identifier: "CacheClearResponse" });

export const RuntimeControlCacheInvalidateRequestEffectSchema = Schema.Struct({
  workflow: Schema.String,
  nodePaths: Schema.optional(Schema.Array(Schema.String)),
}).annotations({ identifier: "CacheInvalidateRequest" });

export const RuntimeControlCacheInvalidateResponseEffectSchema = Schema.Struct({
  ok: Schema.Boolean,
  invalidated: Schema.Number,
}).annotations({ identifier: "CacheInvalidateResponse" });

export const RuntimeControlCacheExplainReasonEffectSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  detail: Schema.optional(Schema.String),
}).annotations({ identifier: "CacheExplainReason" });

export const RuntimeControlCacheExplainCandidateEffectSchema = Schema.Struct({
  runId: Schema.String,
  scope: Schema.Literal("local", "global"),
  nodePath: Schema.String,
  displayPath: Schema.String,
  nodeName: Schema.String,
  nodeKind: Schema.String,
  createdAt: Schema.String,
  invalidated: Schema.Boolean,
  fragmentHash: Schema.optional(Schema.String),
  reasons: Schema.Array(RuntimeControlCacheExplainReasonEffectSchema),
}).annotations({ identifier: "CacheExplainCandidate" });

export const RuntimeControlCacheExplanationEffectSchema = Schema.Struct({
  workflow: Schema.String,
  path: Schema.String,
  name: Schema.String,
  status: Schema.Literal("cached", "pending"),
  reason: RuntimeControlCacheExplainReasonEffectSchema,
  runId: Schema.optional(Schema.String),
  scope: Schema.Literal("local", "global"),
  cacheWorkflow: Schema.String,
  cacheNodePath: Schema.String,
  upstreamRunIds: Schema.Array(Schema.String),
  cacheTTL: Schema.optional(Schema.Unknown),
  candidates: Schema.Array(RuntimeControlCacheExplainCandidateEffectSchema),
}).annotations({ identifier: "CacheExplanation" });

export const RuntimeControlCacheExplainRequestEffectSchema = Schema.Struct({
  workflow: Schema.String,
  task: Schema.optional(Schema.String),
}).annotations({ identifier: "CacheExplainRequest" });

export const RuntimeControlCacheExplainResponseEffectSchema = Schema.Struct({
  workflow: Schema.String,
  explanations: Schema.Array(RuntimeControlCacheExplanationEffectSchema),
}).annotations({ identifier: "CacheExplainResponse" });

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
export type RuntimeControlOperationCli = Schema.Schema.Type<typeof RuntimeControlOperationCliEffectSchema>;
export type RuntimeControlOperation = Schema.Schema.Type<typeof RuntimeControlOperationEffectSchema>;
export type RuntimeControlOperationsManifest = Schema.Schema.Type<typeof RuntimeControlOperationsManifestEffectSchema>;
export type RuntimeControlWorkflowsResponse = Schema.Schema.Type<typeof RuntimeControlWorkflowsResponseEffectSchema>;
export type RuntimeControlWorkspace = Schema.Schema.Type<typeof RuntimeControlWorkspaceEffectSchema>;
export type RuntimeControlWorkspacesResponse = Schema.Schema.Type<typeof RuntimeControlWorkspacesResponseEffectSchema>;
export type RuntimeControlSnapshotsResponse = Schema.Schema.Type<typeof RuntimeControlSnapshotsResponseEffectSchema>;
export type RuntimeControlCacheEntry = Schema.Schema.Type<typeof RuntimeControlCacheEntryEffectSchema>;
export type RuntimeControlCacheRequest = Schema.Schema.Type<typeof RuntimeControlCacheRequestEffectSchema>;
export type RuntimeControlCacheResponse = Schema.Schema.Type<typeof RuntimeControlCacheResponseEffectSchema>;
export type RuntimeControlCacheClearRequest = Schema.Schema.Type<typeof RuntimeControlCacheClearRequestEffectSchema>;
export type RuntimeControlCacheClearResponse = Schema.Schema.Type<typeof RuntimeControlCacheClearResponseEffectSchema>;
export type RuntimeControlCacheInvalidateRequest = Schema.Schema.Type<typeof RuntimeControlCacheInvalidateRequestEffectSchema>;
export type RuntimeControlCacheInvalidateResponse = Schema.Schema.Type<typeof RuntimeControlCacheInvalidateResponseEffectSchema>;
export type RuntimeControlCacheExplainReason = Schema.Schema.Type<typeof RuntimeControlCacheExplainReasonEffectSchema>;
export type RuntimeControlCacheExplainCandidate = Schema.Schema.Type<typeof RuntimeControlCacheExplainCandidateEffectSchema>;
export type RuntimeControlCacheExplanation = Schema.Schema.Type<typeof RuntimeControlCacheExplanationEffectSchema>;
export type RuntimeControlCacheExplainRequest = Schema.Schema.Type<typeof RuntimeControlCacheExplainRequestEffectSchema>;
export type RuntimeControlCacheExplainResponse = Schema.Schema.Type<typeof RuntimeControlCacheExplainResponseEffectSchema>;
export type RuntimeControlRunOperationRequest = Schema.Schema.Type<typeof RuntimeControlRunOperationRequestEffectSchema>;
export type RuntimeControlRun = Schema.Schema.Type<typeof RuntimeControlRunEffectSchema>;
export type RuntimeControlRunsResponse = Schema.Schema.Type<typeof RuntimeControlRunsResponseEffectSchema>;
export type RuntimeControlRunStarted = Schema.Schema.Type<typeof RuntimeControlRunStartedEffectSchema>;
export type RuntimeControlHostResponse = Schema.Schema.Type<typeof RuntimeControlHostResponseEffectSchema>;
export type RuntimeControlOkResponse = Schema.Schema.Type<typeof RuntimeControlOkResponseEffectSchema>;

const runId = HttpApiSchema.param("runId", Schema.String);
const requestId = HttpApiSchema.param("requestId", Schema.String);

export const runtimeControlApi = HttpApi.make("rigkit-runtime")
  .annotate(OpenApi.Title, "Stoke runtime")
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
      .add(HttpApiEndpoint.get("cache", "/cache").addSuccess(RuntimeControlCacheResponseEffectSchema))
      .add(HttpApiEndpoint.post("listCache", "/cache/list")
        .setPayload(RuntimeControlCacheRequestEffectSchema)
        .addSuccess(RuntimeControlCacheResponseEffectSchema))
      .add(HttpApiEndpoint.post("explainCache", "/cache/explain")
        .setPayload(RuntimeControlCacheExplainRequestEffectSchema)
        .addSuccess(RuntimeControlCacheExplainResponseEffectSchema))
      .add(HttpApiEndpoint.post("clearCache", "/cache/clear")
        .setPayload(RuntimeControlCacheClearRequestEffectSchema)
        .addSuccess(RuntimeControlCacheClearResponseEffectSchema))
      .add(HttpApiEndpoint.post("invalidateCache", "/cache/invalidate")
        .setPayload(RuntimeControlCacheInvalidateRequestEffectSchema)
        .addSuccess(RuntimeControlCacheInvalidateResponseEffectSchema))
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
