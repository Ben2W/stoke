import type {
  EnvResolver,
  FdevConfigDefinition,
  JsonObject,
  OutputSchema,
  OutputSchemaValue,
  WorkflowDefinition,
  WorkflowCreateDefinition,
  WorkflowCreateHandler,
  WorkflowInputFieldDefinition,
  WorkflowInputShape,
  WorkflowOperationDefinition,
  WorkflowOperationInputBuilder,
  WorkflowOperationInputHelpers,
  WorkflowOperationOptions,
  WorkflowNodeDefinition,
  WorkflowProviderDefinition,
  WorkflowProviderMap,
  WorkflowSequenceBuilder,
  WorkflowTaskHandler,
  WorkflowTaskNode,
  WorkflowTaskOptions,
  WorkflowTaskResult,
  WorkflowWorkspaceDefinition,
} from "./types.ts";

const reservedTaskContextKeys = new Set(["ctx", "runtime", "providers"]);
const reservedHostOperationIds = new Set(["init", "doctor", "projects", "run", "help", "version", "completion"]);

const readEnv = (name: string, fallback?: string): string => {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
};

export const env: EnvResolver = Object.assign(readEnv, {
  secret: readEnv,
});

export function workflow<const Name extends string, const Providers extends WorkflowProviderMap>(
  name: Name,
  options: { providers: Providers },
): WorkflowDefinition<Name, Providers> {
  validateProviders(options.providers);

  const app = {
    kind: "fdev.workflow" as const,
    name,
    providers: options.providers,
    sequence: <InputContext extends JsonObject = {}>(sequenceName: string) =>
      createSequence(app as unknown as WorkflowDefinition<string, Providers>, sequenceName, []),
    task: (taskName: string, optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, {}, any>, maybeHandler?: WorkflowTaskHandler<Providers, {}, any>) =>
      createTask(app as unknown as WorkflowDefinition<string, Providers>, taskName, optionsOrHandler as any, maybeHandler as any),
    step: (taskName: string, optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, {}, any>, maybeHandler?: WorkflowTaskHandler<Providers, {}, any>) =>
      createTask(app as unknown as WorkflowDefinition<string, Providers>, taskName, optionsOrHandler as any, maybeHandler as any),
  };

  return app as unknown as WorkflowDefinition<Name, Providers>;
}

export function sequence<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  InputContext extends JsonObject = {},
>(name: string): WorkflowSequenceBuilder<Providers, InputContext, InputContext> {
  return workflow(name, { providers: {} as Providers }).sequence<InputContext>(name);
}

export function defineConfig<
  const Providers extends WorkflowProviderMap,
  const Workflows extends Record<string, WorkflowNodeDefinition<any, any, any>>,
>(options: {
  providers: Providers;
  workflows: Workflows;
}): FdevConfigDefinition<Providers, Workflows> {
  validateProviders(options.providers);
  for (const [name, node] of Object.entries(options.workflows)) {
    if (!isWorkflowNode(node)) {
      throw new Error(`Workflow ${name} is not a valid fdev workflow node`);
    }
  }
  return {
    kind: "fdev.config",
    providers: options.providers,
    workflows: options.workflows,
  };
}

export function defineProvider<
  const ProviderId extends string,
  const Config extends object,
  Runtime = unknown,
  WorkspaceContext extends object = object,
>(
  providerId: ProviderId,
  config: WorkflowProviderDefinition<ProviderId, Config, Runtime, WorkspaceContext>["config"],
  plugin?: unknown,
): WorkflowProviderDefinition<ProviderId, Config, Runtime, WorkspaceContext> {
  return {
    kind: "fdev.provider",
    providerId,
    config,
    plugin,
  };
}

export function isWorkflow(value: unknown): value is WorkflowDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.workflow");
}

export function isWorkflowNode(value: unknown): value is WorkflowNodeDefinition<any, any, any> {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.workflow-node");
}

export function isFdevConfig(value: unknown): value is FdevConfigDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.config");
}

export function isProviderDefinition(value: unknown): value is WorkflowProviderDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.provider");
}

function createSequence<Providers extends WorkflowProviderMap, InputContext extends JsonObject, OutputContext extends JsonObject>(
  app: WorkflowDefinition<string, Providers>,
  name: string,
  children: readonly WorkflowNodeDefinition<Providers, any, any>[],
  workspace?: WorkflowWorkspaceDefinition<Providers, OutputContext>,
  create?: WorkflowCreateDefinition<Providers, OutputContext>,
  operations: readonly WorkflowOperationDefinition<Providers, any>[] = [],
): WorkflowSequenceBuilder<Providers, InputContext, OutputContext> {
  const node = {
    kind: "fdev.workflow-node" as const,
    nodeKind: "sequence" as const,
    name,
    workflow: app,
    children,
    workspaceDefinition: workspace,
    createDefinition: create,
    operations,
    task: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any);
      return createSequence(app, name, [...children, task], workspace, create, operations);
    },
    step: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any);
      return createSequence(app, name, [...children, task], workspace, create, operations);
    },
    add: (child: WorkflowNodeDefinition<Providers, any, any>) => {
      assertSameWorkflow(app, child);
      return createSequence(app, name, [...children, child], workspace, create, operations);
    },
    parallel: (branches: Record<string, WorkflowNodeDefinition<Providers, any, any>>) => {
      for (const [branchName, branch] of Object.entries(branches)) {
        assertSameWorkflow(app, branch);
        if (!branchName) throw new Error(`Parallel branch names must be non-empty`);
      }

      const parallelNode: WorkflowNodeDefinition<Providers, OutputContext, any> & {
        nodeKind: "parallel";
        branches: Record<string, WorkflowNodeDefinition<Providers, any, any>>;
      } = {
        kind: "fdev.workflow-node",
        nodeKind: "parallel",
        name: "parallel",
        workflow: app,
        branches,
      };
      return createSequence(app, name, [...children, parallelNode], workspace, create, operations);
    },
    workspace: (definition: WorkflowWorkspaceDefinition<Providers, OutputContext>) =>
      createSequence(app, name, children, definition, create, operations),
    create: (handler: WorkflowCreateHandler<Providers, OutputContext, any>) =>
      createSequence(app, name, children, workspace, { handler }, operations),
    operation: (id: string, options: WorkflowOperationOptions<Providers, any>) =>
      createSequence(app, name, children, workspace, create, [...operations, createOperation(id, options)]),
  };

  return node as unknown as WorkflowSequenceBuilder<Providers, InputContext, OutputContext>;
}

function createOperation<Providers extends WorkflowProviderMap, Input extends object>(
  id: string,
  options: WorkflowOperationOptions<Providers, Input>,
): WorkflowOperationDefinition<Providers, Input> {
  const normalized = id.trim();
  if (!normalized) throw new Error(`Operation ids must be non-empty`);
  if (reservedHostOperationIds.has(normalized)) {
    throw new Error(`Operation id ${normalized} is reserved by the fdev host`);
  }
  return {
    id: normalized,
    title: options.title,
    description: options.description,
    createsWorkspace: options.createsWorkspace,
    requiredHostMethods: normalizeHostMethodRequirements(options.requiredHostMethods),
    requiredHostCapabilities: normalizeHostCapabilityRequirements(options.requiredHostCapabilities),
    input: typeof options.input === "function"
      ? options.input(createOperationInputHelpers())
      : options.input,
    run: options.run,
  };
}

function normalizeHostMethodRequirements(
  methods: WorkflowOperationOptions<any, any>["requiredHostMethods"],
) {
  return methods?.map((method) => {
    const id = method.id.trim();
    if (!id) throw new Error(`Host method requirements must have non-empty ids`);
    return {
      id,
      ...(method.modes?.length ? { modes: [...method.modes] } : {}),
    };
  });
}

function normalizeHostCapabilityRequirements(
  capabilities: WorkflowOperationOptions<any, any>["requiredHostCapabilities"],
) {
  return capabilities?.map((capability) => {
    const id = capability.id.trim();
    if (!id) throw new Error(`Host capability requirements must have non-empty ids`);
    const schemaHash = capability.schemaHash?.trim();
    return {
      id,
      ...(schemaHash ? { schemaHash } : {}),
    };
  });
}

function createOperationInputHelpers(): WorkflowOperationInputHelpers {
  return {
    workspaceInput: (options) => createOperationInputBuilder([{
      kind: "workspace",
      name: options.name,
      description: options.description,
      position: options.position,
      required: options.required ?? true,
    }]),
    string: (options) => ({
      kind: "string",
      name: options.name ?? "",
      description: options.description,
      position: options.position,
      required: options.required ?? options.defaultValue === undefined,
      defaultValue: options.defaultValue,
    }),
    boolean: (options) => ({
      kind: "boolean",
      name: options.name ?? "",
      description: options.description,
      position: options.position,
      required: options.required ?? false,
      defaultValue: options.defaultValue,
    }),
    number: (options) => ({
      kind: "number",
      name: options.name ?? "",
      description: options.description,
      position: options.position,
      required: options.required ?? options.defaultValue === undefined,
      defaultValue: options.defaultValue,
    }),
  };
}

function createOperationInputBuilder<Input extends object>(
  fields: readonly WorkflowInputFieldDefinition[],
): WorkflowOperationInputBuilder<Input> {
  return {
    fields,
    extend(shape: WorkflowInputShape) {
      const nextFields = Object.entries(shape).map(([name, field]) => ({
        ...field,
        name: field.name || name,
      }));
      return createOperationInputBuilder([...fields, ...nextFields]);
    },
  } as WorkflowOperationInputBuilder<Input>;
}

function createTask<Providers extends WorkflowProviderMap, InputContext extends JsonObject>(
  app: WorkflowDefinition<string, Providers>,
  name: string,
  optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, InputContext, any>,
  maybeHandler?: WorkflowTaskHandler<Providers, InputContext, any>,
): WorkflowTaskNode<Providers, InputContext, any> {
  const options = typeof optionsOrHandler === "function" ? undefined : optionsOrHandler;
  const handler = (typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler) as
    | WorkflowTaskHandler<Providers, InputContext, any>
    | undefined;
  if (!handler) throw new Error(`Task ${name} is missing a handler`);

  return {
    kind: "fdev.workflow-node",
    nodeKind: "task",
    name,
    workflow: app,
    options,
    handler,
  };
}

function validateProviders(providers: WorkflowProviderMap): void {
  for (const [name, provider] of Object.entries(providers)) {
    if (reservedTaskContextKeys.has(name)) {
      throw new Error(`Provider name ${name} is reserved by the task context`);
    }
    if (!isProviderDefinition(provider)) {
      throw new Error(`Provider ${name} is not a valid fdev provider`);
    }
  }
}

function assertSameWorkflow(
  app: WorkflowDefinition<string, any>,
  node: WorkflowNodeDefinition<any, any, any>,
): void {
  if (node.workflow !== app) {
    throw new Error(`Node ${node.name} belongs to a different workflow`);
  }
}

function getKind(value: object): unknown {
  return (value as { kind?: unknown }).kind;
}
