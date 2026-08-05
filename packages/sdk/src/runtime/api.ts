import { OpenApi } from "@effect/platform";
import { runtimeControlApi } from "@stoke/runtime-client";

export {
  RuntimeControlHealthEffectSchema as RuntimeHealthEffectSchema,
  RuntimeControlMetadataEffectSchema as RuntimeMetadataEffectSchema,
  RuntimeControlOkResponseEffectSchema as OkResponseEffectSchema,
  RuntimeControlOperationCliEffectSchema as RuntimeOperationCliEffectSchema,
  RuntimeControlOperationEffectSchema as RuntimeOperationEffectSchema,
  RuntimeControlOperationsManifestEffectSchema as OperationsManifestEffectSchema,
  RuntimeControlProjectInfoEffectSchema as ProjectInfoEffectSchema,
  RuntimeControlRunEffectSchema as RuntimeRunEffectSchema,
  RuntimeControlRunStartedEffectSchema as RunStartedEffectSchema,
  RuntimeControlRunsResponseEffectSchema as RunsResponseEffectSchema,
  RuntimeControlSnapshotsResponseEffectSchema as SnapshotsResponseEffectSchema,
  RuntimeControlCacheEntryEffectSchema as CacheEntryEffectSchema,
  RuntimeControlCacheExplainCandidateEffectSchema as CacheExplainCandidateEffectSchema,
  RuntimeControlCacheExplainReasonEffectSchema as CacheExplainReasonEffectSchema,
  RuntimeControlCacheExplainRequestEffectSchema as CacheExplainRequestEffectSchema,
  RuntimeControlCacheExplainResponseEffectSchema as CacheExplainResponseEffectSchema,
  RuntimeControlCacheExplanationEffectSchema as CacheExplanationEffectSchema,
  RuntimeControlCacheRequestEffectSchema as CacheRequestEffectSchema,
  RuntimeControlCacheResponseEffectSchema as CacheResponseEffectSchema,
  RuntimeControlCacheClearRequestEffectSchema as CacheClearRequestEffectSchema,
  RuntimeControlCacheClearResponseEffectSchema as CacheClearResponseEffectSchema,
  RuntimeControlWorkflowSummaryEffectSchema as WorkflowSummaryEffectSchema,
  RuntimeControlWorkflowsResponseEffectSchema as WorkflowsResponseEffectSchema,
  RuntimeControlWorkspaceEffectSchema as WorkspaceEffectSchema,
  RuntimeControlWorkspacesResponseEffectSchema as WorkspacesResponseEffectSchema,
  runtimeControlApi,
} from "@stoke/runtime-client";

export function runtimeControlOpenApiDocument(): OpenApi.OpenAPISpec {
  const spec = OpenApi.fromApi(runtimeControlApi, { additionalPropertiesStrategy: "allow" });
  spec.security = [{ bearerAuth: [] }];
  spec.components.securitySchemes = {
    ...spec.components.securitySchemes,
    bearerAuth: {
      type: "http",
      scheme: "bearer",
    },
  };

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const operation of Object.values(methods)) {
      operation.security = path === "/health" ? [] : [{ bearerAuth: [] }];
    }
  }

  const hostResponseOperation = spec.paths["/host-responses/{requestId}"]?.post as any;
  const hostResponseSchema = hostResponseOperation?.requestBody?.content?.["application/json"]?.schema;
  if (hostResponseSchema) {
    spec.components.schemas.HostResponse = hostResponseSchema;
    hostResponseOperation.requestBody.content["application/json"].schema = {
      $ref: "#/components/schemas/HostResponse",
    };
  }

  spec.paths["/runs/{runId}/session"] = {
    get: {
      tags: ["control"],
      operationId: "control.runSession",
      parameters: [{
        name: "runId",
        in: "path",
        required: true,
        schema: { type: "string" },
      }],
      security: [{ bearerAuth: [] }],
      responses: {
        "101": { description: "Run WebSocket session" },
      },
    },
  };

  return spec;
}
