import type { JsonObject, WorkflowTaskHandler } from "@rigkit/sdk";
import type { SetupProviders } from "../lib/providers";

export type SetupTaskHandler<
  Input extends JsonObject,
  Output extends JsonObject,
> = WorkflowTaskHandler<
  SetupProviders,
  Input,
  string,
  { ctx: Output }
>;
