import { runtimeControlOpenApiDocument } from "./api.ts";

export function openApiDocument(): Record<string, unknown> {
  return runtimeControlOpenApiDocument() as unknown as Record<string, unknown>;
}
