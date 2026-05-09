import { FDEV_RUNTIME_VERSION } from "./version.ts";

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "fdev runtime",
      version: FDEV_RUNTIME_VERSION,
    },
    paths: {
      "/health": { get: { responses: { "200": { description: "Runtime health" } } } },
      "/runtime": { get: { responses: { "200": { description: "Runtime metadata" } } } },
      "/project": { get: { responses: { "200": { description: "Project info" } } } },
      "/operations": { get: { responses: { "200": { description: "Project operations" } } } },
      "/workflows": { get: { responses: { "200": { description: "Loaded workflows" } } } },
      "/workspaces": { get: { responses: { "200": { description: "Known workspaces" } } } },
      "/snapshots": { get: { responses: { "200": { description: "Known snapshots" } } } },
      "/runs": {
        get: { responses: { "200": { description: "Runs" } } },
        post: { responses: { "202": { description: "Started run" } } },
      },
      "/runs/{runId}": { get: { responses: { "200": { description: "Run" } } } },
      "/runs/{runId}/events": { get: { responses: { "200": { description: "Run event stream" } } } },
      "/host-responses/{requestId}": { post: { responses: { "200": { description: "Host response" } } } },
      "/shutdown": { post: { responses: { "200": { description: "Shutdown accepted" } } } },
    },
  };
}
