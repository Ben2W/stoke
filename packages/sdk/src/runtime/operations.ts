import {
  createDevMachineEngine,
  type DevMachineEngine,
  type EngineOperationSummary,
  type JsonValue,
  type LocalHostCapabilityRequestOptions,
  type WorkspaceRecord,
} from "@usestoke/engine";
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
import { createRuntimeStateCoordinator, type RuntimeStateCoordinator } from "./state.ts";
import { STOKE_RUNTIME_VERSION } from "./version.ts";

export type EngineLoadOptions = {
  projectId?: string;
  projectDir: string;
  configPath: string;
  state?: RuntimeStateCoordinator;
  source?: JsonValue;
};

export async function loadEngine(input: EngineLoadOptions): Promise<DevMachineEngine> {
  const state = input.state ?? createRuntimeStateCoordinator();
  const engine = await createDevMachineEngine({
    projectDir: input.projectDir,
    configPath: input.configPath,
    state: state.project,
    stateFactory: state.stateFactory,
    workspaceCreatedFrom: workspaceCreatedFromSource(input.source),
  });
  await engine.load();
  return engine;
}

export function runOperation(run: RunRecord, store: RunStore, options: EngineLoadOptions): void {
  executeOperation(run, store, options).catch((error) => failRun(run, normalizeRuntimeRunError(error), store));
}

async function executeOperation(run: RunRecord, store: RunStore, options: EngineLoadOptions): Promise<void> {
  const state = options.state ?? createRuntimeStateCoordinator();
  const engine = await createDevMachineEngine({
    projectDir: options.projectDir,
    configPath: options.configPath,
    state: state.project,
    stateFactory: state.stateFactory,
    workspaceCreatedFrom: workspaceCreatedFromSource(options.source),
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
      prompt: {
        message: async (request) => {
          await requestHost(store, run, "message.show", request);
        },
        text: async (request) => {
          const result = await requestHost(store, run, "prompt.text", request);
          if (typeof result !== "string") {
            throw new Error("Host text prompt returned a non-string result");
          }
          return result;
        },
        confirm: async (request) => {
          const result = await requestHost(store, run, "prompt.confirm", request);
          if (typeof result !== "boolean") {
            throw new Error("Host confirm prompt returned a non-boolean result");
          }
          return result;
        },
        select: async (request) => {
          const result = await requestHost(store, run, "prompt.select", request);
          if (typeof result !== "string") {
            throw new Error("Host select prompt returned a non-string result");
          }
          return result;
        },
      },
      command: async (command) => {
        const result = await requestHost(store, run, "host.command.run", command);
        return HostCommandResultSchema.parse(result);
      },
      requestCapability: async <Result = unknown>(
        capability: string,
        params: unknown,
        requestOptions?: LocalHostCapabilityRequestOptions,
      ) =>
        await requestHostCapability(store, run, capability, params, requestOptions) as Result,
      requestCapabilitySession: async <Result = unknown>(
        capability: string,
        params: unknown,
        requestOptions?: LocalHostCapabilityRequestOptions,
      ) =>
        await requestHostCapabilitySession<Result>(store, run, capability, params, requestOptions),
    },
  });
  engine.onEvent((event) => emitRunEvent(run, event));
  await engine.load();

  const result = await engine.runRuntimeOperation({ operation: run.operation, input: run.input });
  await state.persist();
  completeRun(run, result, store);
}

function workspaceCreatedFromSource(source: JsonValue | undefined): WorkspaceRecord["createdFrom"] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  if (source.kind === "dashboard") return { kind: "dashboard" };
  const deviceId = source.deviceId;
  const checkoutId = source.checkoutId;
  if (typeof deviceId !== "string" || !deviceId) return undefined;
  return {
    kind: "checkout",
    deviceId,
    ...(typeof checkoutId === "string" && checkoutId ? { checkoutId } : {}),
  };
}

export function operationsFor(engine: DevMachineEngine): RuntimeOperation[] {
  return engine.listRuntimeOperations().map((operation) => runtimeOperationForEngineOperation(engine, operation));
}

export function workspaceOperationsFor(engine: DevMachineEngine): RuntimeOperation[] {
  return engine.listRuntimeWorkspaceOperations().map((operation) =>
    runtimeOperationForEngineOperation(engine, operation)
  );
}

function runtimeOperationForEngineOperation(engine: DevMachineEngine, operation: EngineOperationSummary): RuntimeOperation {
  const required = operation.inputFields
    .filter((field) => field.required ?? true)
    .map((field) => field.name);
  const properties = Object.fromEntries(
    operation.inputFields.map((field) => [field.name, jsonSchemaForField(engine, operation, field)]),
  );
  const hasWorkspaceInput = operation.inputFields.some((field) => field.kind === "workspace");
  const inputSchema = operation.inputSchema ?? objectSchema(properties, required);
  const cli = operation.cli
    ? cloneOperationCli(operation.cli)
    : operation.inputSchema ? undefined : cliForFields(operation.inputFields);
  return {
    workflow: operation.workflow,
    id: operation.id,
    ...(operation.aliases?.length ? { aliases: [...operation.aliases] } : {}),
    kind: operation.kind ?? (hasWorkspaceInput ? "workspace-action" : "command"),
    source: operation.source ?? "config",
    title: operation.title ?? titleize(operation.id),
    description: operation.description ?? "",
    createsWorkspace: operation.createsWorkspace,
    ...(cli ? { cli } : {}),
    inputSchema,
    requiredCapabilities: operation.requiredCapabilities?.map((capability) => ({ ...capability })) ?? [],
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
    schema["x-stoke-input"] = {
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
  const workspaceOperations = workspaceOperationsFor(engine);
  return {
    operations,
    workspaceOperations,
  };
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
