import {
  createDevMachineEngine,
  type DevMachineEngine,
  type EngineOperationSummary,
  type JsonValue,
} from "@rigkit/engine";
import { normalizeRuntimeRunError } from "./errors.ts";
import {
  HostCommandResultSchema,
  objectSchema,
  type JsonSchema,
  type RuntimeOperation,
  type RuntimeOperationsManifest,
} from "./protocol.ts";
import {
  completeRun,
  emitRunEvent,
  failRun,
  requestHost,
  requestHostCapability,
  requestHostCapabilitySession,
  type RunRecord,
  type RunStore,
} from "./runs.ts";
import { createRuntimeStateService } from "./state.ts";
import { RIGKIT_RUNTIME_VERSION } from "./version.ts";

export type EngineLoadOptions = {
  projectId?: string;
  projectDir: string;
  configPath: string;
  statePath?: string;
  source?: JsonValue;
};

export async function loadEngine(input: EngineLoadOptions): Promise<DevMachineEngine> {
  const engine = await createDevMachineEngine({
    projectDir: input.projectDir,
    configPath: input.configPath,
    state: createRuntimeStateService({
      projectId: input.projectId,
      projectDir: input.projectDir,
      configPath: input.configPath,
      statePath: input.statePath,
      runtimeVersion: RIGKIT_RUNTIME_VERSION,
      source: input.source,
    }),
  });
  await engine.load();
  return engine;
}

export function runOperation(run: RunRecord, store: RunStore, options: EngineLoadOptions): void {
  executeOperation(run, store, options).catch((error) => failRun(run, normalizeRuntimeRunError(error), store));
}

async function executeOperation(run: RunRecord, store: RunStore, options: EngineLoadOptions): Promise<void> {
  const engine = await createDevMachineEngine({
    projectDir: options.projectDir,
    configPath: options.configPath,
    state: createRuntimeStateService({
      projectId: options.projectId,
      projectDir: options.projectDir,
      configPath: options.configPath,
      statePath: options.statePath,
      runtimeVersion: RIGKIT_RUNTIME_VERSION,
      source: options.source,
    }),
    interaction: {
      present: async (request) => {
        await requestHost(store, run, "open.external", {
          target: request.url,
          kind: "url",
          label: request.title,
        });
      },
    },
    local: {
      open: async (target) => {
        await requestHost(store, run, "open.external", { target, kind: guessExternalKind(target) });
      },
      command: async (command) => {
        const result = await requestHost(store, run, "host.command.run", command);
        return HostCommandResultSchema.parse(result);
      },
      requestCapability: async <Result = unknown>(capability: string, params: unknown) =>
        await requestHostCapability(store, run, capability, params) as Result,
      requestCapabilitySession: async <Result = unknown>(capability: string, params: unknown) =>
        await requestHostCapabilitySession<Result>(store, run, capability, params),
    },
  });
  engine.onEvent((event) => emitRunEvent(run, event));
  await engine.load();

  const result = await engine.runRuntimeOperation({ operation: run.operation, input: run.input });
  completeRun(run, result, store);
}

export function operationsFor(engine: DevMachineEngine): RuntimeOperation[] {
  return engine.listRuntimeOperations().map((operation) => runtimeOperationForEngineOperation(engine, operation));
}

function runtimeOperationForEngineOperation(engine: DevMachineEngine, operation: EngineOperationSummary): RuntimeOperation {
  const required = operation.inputFields
    .filter((field) => field.required ?? true)
    .map((field) => field.name);
  const properties = Object.fromEntries(
    operation.inputFields.map((field) => [field.name, jsonSchemaForField(engine, operation, field)]),
  );
  const hasWorkspaceInput = operation.inputFields.some((field) => field.kind === "workspace");
  return {
    id: operation.id,
    ...(operation.aliases?.length ? { aliases: [...operation.aliases] } : {}),
    kind: operation.kind ?? (hasWorkspaceInput ? "workspace-action" : "command"),
    source: operation.source ?? "config",
    title: operation.title ?? titleize(operation.id),
    description: operation.description ?? "",
    createsWorkspace: operation.createsWorkspace,
    requiredHostMethods: operation.requiredHostMethods?.map((method) => ({
      id: method.id,
      ...(method.modes?.length ? { modes: [...method.modes] } : {}),
    })),
    requiredHostCapabilities: operation.requiredHostCapabilities?.map((capability) => ({
      id: capability.id,
      ...(capability.schemaHash ? { schemaHash: capability.schemaHash } : {}),
    })),
    cli: operation.cli ? cloneOperationCli(operation.cli) : cliForFields(operation.inputFields),
    inputSchema: objectSchema(properties, required),
  };
}

function jsonSchemaForField(
  engine: DevMachineEngine,
  operation: EngineOperationSummary,
  field: EngineOperationSummary["inputFields"][number],
): JsonSchema {
  const schema: JsonSchema = {
    type: field.kind === "boolean" || field.kind === "number" ? field.kind : "string",
    ...(field.description ? { description: field.description } : {}),
    ...(field.defaultValue !== undefined ? { default: field.defaultValue } : {}),
  };
  if (field.kind === "string" && (field.required ?? true)) {
    schema.minLength = 1;
  }
  if (field.name === "workflow") {
    const workflows = engine.listWorkflows().map((workflow) => workflow.name);
    Object.assign(schema, workflowJsonSchema(workflows));
  }
  if (field.kind === "workspace") {
    schema["x-rigkit-input"] = {
      kind: "workspace",
      workflow: operation.workflow,
      resolve: "data",
    };
  }
  return schema;
}

function cloneOperationCli(cli: NonNullable<EngineOperationSummary["cli"]>): NonNullable<RuntimeOperation["cli"]> {
  return {
    ...(cli.positionals ? { positionals: cli.positionals.map((item) => ({ ...item })) } : {}),
    ...(cli.options
      ? {
        options: cli.options.map((item) => ({
          ...item,
          ...(item.aliases ? { aliases: [...item.aliases] } : {}),
        })),
      }
      : {}),
  };
}

function cliForFields(fields: EngineOperationSummary["inputFields"]): NonNullable<RuntimeOperation["cli"]> {
  return {
    positionals: fields
      .filter((field) => typeof field.position === "number")
      .map((field) => ({ name: field.name, index: field.position! })),
    options: fields
      .filter((field) => typeof field.position !== "number")
      .map((field) => ({
        name: field.name,
        flag: `--${dashCase(field.name)}`,
        required: field.required ?? true,
        type: field.kind === "boolean" || field.kind === "number" ? field.kind : "string",
      })),
  };
}

export function operationManifestFor(engine: DevMachineEngine): RuntimeOperationsManifest {
  const operations = operationsFor(engine);
  return {
    hostMethods: {
      known: [
        { id: "message.show" },
        { id: "prompt.text" },
        { id: "prompt.confirm" },
        { id: "prompt.select" },
        { id: "open.external" },
        { id: "host.command.run", modes: ["capture", "interactive"] },
      ],
      requiredByOperations: Object.fromEntries(
        operations
          .filter((operation) => operation.requiredHostMethods?.length)
          .map((operation) => [
            operation.id,
            operation.requiredHostMethods!.flatMap((method) =>
              method.modes?.length
                ? method.modes.map((mode) => `${method.id}:${mode}`)
                : [method.id]
            ),
          ]),
      ),
    },
    hostCapabilities: {
      optional: dedupeHostCapabilities(
        operations.flatMap((operation) => operation.requiredHostCapabilities ?? []),
      ),
      requiredByOperations: Object.fromEntries(
        operations
          .filter((operation) => operation.requiredHostCapabilities?.length)
          .map((operation) => [operation.id, operation.requiredHostCapabilities!.map((capability) => capability.id)]),
      ),
    },
    operations,
  };
}

function dedupeHostCapabilities(
  capabilities: Array<{ id: string; schemaHash?: string }>,
): Array<{ id: string; schemaHash?: string }> {
  const seen = new Set<string>();
  const deduped: Array<{ id: string; schemaHash?: string }> = [];
  for (const capability of capabilities) {
    const key = capability.schemaHash ? `${capability.id}\0${capability.schemaHash}` : capability.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      id: capability.id,
      ...(capability.schemaHash ? { schemaHash: capability.schemaHash } : {}),
    });
  }
  return deduped;
}

function workflowJsonSchema(workflows: string[]): JsonSchema {
  return workflows.length > 0
    ? { type: "string", enum: workflows }
    : { type: "string" };
}

function dashCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function titleize(value: string): string {
  return value
    .split(/[-_.\s]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function guessExternalKind(target: string): "url" | "file" | "unknown" {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return "url";
  if (target.startsWith("/")) return "file";
  return "unknown";
}
