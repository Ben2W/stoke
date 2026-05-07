import type {
  EnvResolver,
  JsonObject,
  OutputSchema,
  OutputSchemaValue,
  WorkflowDefinition,
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

const reservedTaskContextKeys = new Set(["ctx", "runtime"]);

export const env: EnvResolver = (name, fallback) => {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
};

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
  };

  return app as unknown as WorkflowDefinition<Name, Providers>;
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

export function isProviderDefinition(value: unknown): value is WorkflowProviderDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.provider");
}

function createSequence<Providers extends WorkflowProviderMap, InputContext extends JsonObject, OutputContext extends JsonObject>(
  app: WorkflowDefinition<string, Providers>,
  name: string,
  children: readonly WorkflowNodeDefinition<Providers, any, any>[],
  workspace?: WorkflowWorkspaceDefinition<Providers, OutputContext>,
): WorkflowSequenceBuilder<Providers, InputContext, OutputContext> {
  const node = {
    kind: "fdev.workflow-node" as const,
    nodeKind: "sequence" as const,
    name,
    workflow: app,
    children,
    workspaceDefinition: workspace,
    task: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any);
      return createSequence(app, name, [...children, task]);
    },
    add: (child: WorkflowNodeDefinition<Providers, any, any>) => {
      assertSameWorkflow(app, child);
      return createSequence(app, name, [...children, child]);
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
      return createSequence(app, name, [...children, parallelNode]);
    },
    workspace: (definition: WorkflowWorkspaceDefinition<Providers, OutputContext>) =>
      createSequence(app, name, children, definition),
  };

  return node as unknown as WorkflowSequenceBuilder<Providers, InputContext, OutputContext>;
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
