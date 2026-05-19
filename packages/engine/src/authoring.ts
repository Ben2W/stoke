import { RESERVED_WORKFLOW_OPERATION_IDS } from "./types.ts";
import type {
  EnvResolver,
  JsonObject,
  OutputSchema,
  OutputSchemaValue,
  WorkflowDefinition,
  WorkflowOperationDefinition,
  WorkflowOperationOptions,
  WorkflowWorkspaceOperationDefinition,
  WorkflowWorkspaceOperationOptions,
  WorkflowNodeDefinition,
  WorkflowProviderDefinition,
  WorkflowProviderMap,
  WorkflowCacheScope,
  WorkflowSequenceBuilder,
  WorkflowTaskHandler,
  WorkflowTaskNode,
  WorkflowTaskOptions,
  WorkflowTaskResult,
  WorkflowWorkspaceDefinition,
} from "./types.ts";

const reservedTaskContextKeys = new Set(["config", "ctx", "runtime", "providers", "step"]);
const reservedHostOperationIds = new Set<string>(RESERVED_WORKFLOW_OPERATION_IDS);

type WorkflowNodeAuthoringOptions = {
  cacheScope?: WorkflowCacheScope;
  config?: JsonObject;
};

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
    kind: "rigkit.workflow" as const,
    name,
    providers: options.providers,
    sequence: <InputContext extends JsonObject = {}>(sequenceName: string) =>
      createSequence(app as unknown as WorkflowDefinition<string, Providers>, sequenceName, []),
    task: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, {}, never, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, {}, never, any>,
    ) =>
      createTask(app as unknown as WorkflowDefinition<string, Providers>, taskName, optionsOrHandler as any, maybeHandler as any),
    step: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, {}, never, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, {}, never, any>,
    ) =>
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

export function defineProvider<
  const ProviderId extends string,
  const Config extends object,
  Runtime = unknown,
>(
  providerId: ProviderId,
  config: WorkflowProviderDefinition<ProviderId, Config, Runtime>["config"],
  plugin?: unknown,
): WorkflowProviderDefinition<ProviderId, Config, Runtime> {
  return {
    kind: "rigkit.provider",
    providerId,
    config,
    plugin,
  };
}

export function isWorkflow(value: unknown): value is WorkflowDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "rigkit.workflow");
}

export function isWorkflowNode(value: unknown): value is WorkflowNodeDefinition<any, any, any> {
  return Boolean(value && typeof value === "object" && getKind(value) === "rigkit.workflow-node");
}

export function isProviderDefinition(value: unknown): value is WorkflowProviderDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "rigkit.provider");
}

function createSequence<
  Providers extends WorkflowProviderMap,
  InputContext extends JsonObject,
  OutputContext extends JsonObject,
  WorkspaceData extends object = JsonObject,
  OperationIds extends string = never,
  WorkspaceOperationIds extends string = never,
  PreviousTaskIds extends string = never,
  Config extends JsonObject = {},
>(
  app: WorkflowDefinition<string, Providers>,
  name: string,
  children: readonly WorkflowNodeDefinition<Providers, any, any>[],
  workspace?: WorkflowWorkspaceDefinition<Providers, OutputContext, any>,
  operations: readonly WorkflowOperationDefinition<Providers, any>[] = [],
  workspaceOperations: readonly WorkflowWorkspaceOperationDefinition<Providers, OutputContext, WorkspaceData, any>[] = [],
  nodeOptions: WorkflowNodeAuthoringOptions = {},
): WorkflowSequenceBuilder<
  Providers,
  InputContext,
  OutputContext,
  WorkspaceData,
  OperationIds,
  WorkspaceOperationIds,
  PreviousTaskIds,
  Config
> {
  const node = {
    kind: "rigkit.workflow-node" as const,
    nodeKind: "sequence" as const,
    name,
    workflow: app,
    cacheScope: nodeOptions.cacheScope,
    config: nodeOptions.config,
    children,
    workspaceDefinition: workspace,
    operations,
    workspaceOperations,
    task: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any);
      return createSequence(app, name, [...children, task], workspace, operations, workspaceOperations, nodeOptions);
    },
    step: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any);
      return createSequence(app, name, [...children, task], workspace, operations, workspaceOperations, nodeOptions);
    },
    add: (child: WorkflowNodeDefinition<Providers, any, any>) => {
      return createSequence(
        app,
        name,
        [...children, attachWorkflowForAuthoring(app, child)],
        workspace,
        operations,
        workspaceOperations,
        nodeOptions,
      );
    },
    parallel: (branches: Record<string, WorkflowNodeDefinition<Providers, any, any>>) => {
      const attachedBranches: Record<string, WorkflowNodeDefinition<Providers, any, any>> = {};
      for (const [branchName, branch] of Object.entries(branches)) {
        if (!branchName) throw new Error(`Parallel branch names must be non-empty`);
        attachedBranches[branchName] = attachWorkflowForAuthoring(app, branch);
      }

      const parallelNode = createParallel(app, "parallel", attachedBranches);
      return createSequence(app, name, [...children, parallelNode], workspace, operations, workspaceOperations, nodeOptions);
    },
    workspace: (definition: WorkflowWorkspaceDefinition<Providers, OutputContext, any>) =>
      createSequence(app, name, children, definition, operations, workspaceOperations, nodeOptions),
    operation: (id: string, options: WorkflowOperationOptions<Providers, any>) => {
      const operation = createOperation(id, options);
      assertUniqueOperationId(operations, operation.id, "Operation");
      return createSequence(app, name, children, workspace, [...operations, operation], workspaceOperations, nodeOptions);
    },
    workspaceOperation: (id: string, options: WorkflowWorkspaceOperationOptions<Providers, OutputContext, any, any>) => {
      const operation = createWorkspaceOperation(id, options);
      assertUniqueOperationId(workspaceOperations, operation.id, "Workspace operation");
      return createSequence(app, name, children, workspace, operations, [...workspaceOperations, operation], nodeOptions);
    },
    global: () =>
      createSequence(app, name, children, workspace, operations, workspaceOperations, {
        ...nodeOptions,
        cacheScope: "global",
      }),
    local: () =>
      createSequence(app, name, children, workspace, operations, workspaceOperations, {
        ...nodeOptions,
        cacheScope: "local",
      }),
    configure: (config: JsonObject) =>
      createSequence(app, name, children, workspace, operations, workspaceOperations, {
        ...nodeOptions,
        config: mergeConfig(nodeOptions.config, config),
      }),
  };

  return node as unknown as WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;
}

function assertUniqueOperationId(
  operations: readonly { id: string }[],
  id: string,
  label: string,
): void {
  if (!operations.some((operation) => operation.id === id)) return;
  throw new Error(`${label} id ${id} is already defined`);
}

function createOperation<Providers extends WorkflowProviderMap, Input extends object>(
  id: string,
  options: WorkflowOperationOptions<Providers, Input>,
): WorkflowOperationDefinition<Providers, Input> {
  const normalized = id.trim();
  if (!normalized) throw new Error(`Operation ids must be non-empty`);
  if (reservedHostOperationIds.has(normalized)) {
    throw new Error(`Operation id ${normalized} is reserved by the Rigkit host`);
  }
  return {
    id: normalized,
    title: options.title,
    description: options.description,
    input: options.input,
    run: options.run,
  };
}

function createWorkspaceOperation<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends JsonObject,
  Input extends object,
>(
  id: string,
  options: WorkflowWorkspaceOperationOptions<Providers, Context, Data, Input>,
): WorkflowWorkspaceOperationDefinition<Providers, Context, Data, Input> {
  const normalized = id.trim();
  if (!normalized) throw new Error(`Workspace operation ids must be non-empty`);
  if (normalized.includes("/")) throw new Error(`Workspace operation ids cannot contain "/"`);
  if (reservedHostOperationIds.has(normalized)) {
    throw new Error(`Workspace operation id ${normalized} is reserved by the Rigkit host`);
  }
  return {
    id: normalized,
    title: options.title,
    description: options.description,
    input: options.input,
    run: options.run,
  };
}

function createTask<
  Providers extends WorkflowProviderMap,
  InputContext extends JsonObject,
  PreviousTaskIds extends string = string,
>(
  app: WorkflowDefinition<string, Providers>,
  name: string,
  optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, InputContext, PreviousTaskIds, any>,
  maybeHandler?: WorkflowTaskHandler<Providers, InputContext, PreviousTaskIds, any>,
  nodeOptions: WorkflowNodeAuthoringOptions = {},
): WorkflowTaskNode<Providers, InputContext, any> {
  const options = typeof optionsOrHandler === "function" ? undefined : optionsOrHandler;
  const handler = (typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler) as
    | WorkflowTaskHandler<Providers, InputContext, PreviousTaskIds, any>
    | undefined;
  if (!handler) throw new Error(`Task ${name} is missing a handler`);

  return {
    kind: "rigkit.workflow-node",
    nodeKind: "task",
    name,
    workflow: app,
    cacheScope: nodeOptions.cacheScope,
    config: nodeOptions.config,
    options,
    handler,
    global: (() => createTask(app, name, options ?? handler, options ? handler : undefined, {
      ...nodeOptions,
      cacheScope: "global",
    })) as WorkflowTaskNode<Providers, InputContext, any>["global"],
    local: (() => createTask(app, name, options ?? handler, options ? handler : undefined, {
      ...nodeOptions,
      cacheScope: "local",
    })) as WorkflowTaskNode<Providers, InputContext, any>["local"],
    configure: ((config: JsonObject) => createTask(app, name, options ?? handler, options ? handler : undefined, {
      ...nodeOptions,
      config: mergeConfig(nodeOptions.config, config),
    })) as WorkflowTaskNode<Providers, InputContext, any>["configure"],
  };
}

function createParallel<Providers extends WorkflowProviderMap, InputContext extends JsonObject>(
  app: WorkflowDefinition<string, Providers>,
  name: string,
  branches: Record<string, WorkflowNodeDefinition<Providers, any, any>>,
  nodeOptions: WorkflowNodeAuthoringOptions = {},
): WorkflowNodeDefinition<Providers, InputContext, any> & {
  nodeKind: "parallel";
  branches: Record<string, WorkflowNodeDefinition<Providers, any, any>>;
} {
  const node = {
    kind: "rigkit.workflow-node" as const,
    nodeKind: "parallel" as const,
    name,
    workflow: app,
    cacheScope: nodeOptions.cacheScope,
    config: nodeOptions.config,
    branches,
    global: () => createParallel(app, name, branches, {
      ...nodeOptions,
      cacheScope: "global",
    }),
    local: () => createParallel(app, name, branches, {
      ...nodeOptions,
      cacheScope: "local",
    }),
    configure: (config: JsonObject) => createParallel(app, name, branches, {
      ...nodeOptions,
      config: mergeConfig(nodeOptions.config, config),
    }),
  };
  return node as unknown as WorkflowNodeDefinition<Providers, InputContext, any> & {
    nodeKind: "parallel";
    branches: Record<string, WorkflowNodeDefinition<Providers, any, any>>;
  };
}

function mergeConfig(previous: JsonObject | undefined, next: JsonObject): JsonObject {
  assertJsonObject(next, "configure input");
  return previous ? { ...previous, ...next } : { ...next };
}

function assertJsonObject(value: JsonObject, label: string): void {
  try {
    JSON.stringify(value);
  } catch (cause) {
    throw new Error(`${label} must be JSON-serializable`, { cause });
  }
  assertJsonValue(value, label);
}

function assertJsonValue(value: unknown, label: string): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${label} must be JSON-serializable`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${label}.${key}`);
    }
    return;
  }
  throw new Error(`${label} must be JSON-serializable`);
}

function validateProviders(providers: WorkflowProviderMap): void {
  for (const [name, provider] of Object.entries(providers)) {
    if (reservedTaskContextKeys.has(name)) {
      throw new Error(`Provider name ${name} is reserved by the task context`);
    }
    if (!isProviderDefinition(provider)) {
      throw new Error(`Provider ${name} is not a valid Rigkit provider`);
    }
  }
}

function attachWorkflowForAuthoring<Providers extends WorkflowProviderMap>(
  app: WorkflowDefinition<string, Providers>,
  node: WorkflowNodeDefinition<Providers, any, any>,
): WorkflowNodeDefinition<Providers, any, any> {
  if (node.workflow === app) return node;
  if (node.nodeKind === "parallel") {
    return {
      ...node,
      workflow: app,
      branches: Object.fromEntries(
        Object.entries(parallelBranchesForAuthoring(node)).map(([name, branch]) => [
          name,
          attachWorkflowForAuthoring(app, branch),
        ]),
      ),
    } as WorkflowNodeDefinition<Providers, any, any>;
  }
  if (node.nodeKind === "sequence") {
    return {
      ...node,
      workflow: app,
      children: sequenceChildrenForAuthoring(node).map((child) => attachWorkflowForAuthoring(app, child)),
    } as WorkflowNodeDefinition<Providers, any, any>;
  }
  return {
    ...node,
    workflow: app,
  } as WorkflowNodeDefinition<Providers, any, any>;
}

function sequenceChildrenForAuthoring(
  node: WorkflowNodeDefinition<any, any, any>,
): readonly WorkflowNodeDefinition<any, any, any>[] {
  return (node as { children?: readonly WorkflowNodeDefinition<any, any, any>[] }).children ?? [];
}

function parallelBranchesForAuthoring(
  node: WorkflowNodeDefinition<any, any, any>,
): Record<string, WorkflowNodeDefinition<any, any, any>> {
  return (node as { branches?: Record<string, WorkflowNodeDefinition<any, any, any>> }).branches ?? {};
}

function getKind(value: object): unknown {
  return (value as { kind?: unknown }).kind;
}
