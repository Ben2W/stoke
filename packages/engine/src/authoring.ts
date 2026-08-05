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
  providerScope?: WorkflowProviderMap;
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

export function workflow<const Name extends string>(name: Name): WorkflowDefinition<Name, {}> {
  const providers = {};

  const app = {
    kind: "stoke.workflow" as const,
    name,
    providers,
    sequence: <InputContext extends JsonObject = {}>(sequenceName: string) =>
      createSequence(app as unknown as WorkflowDefinition<string, {}>, sequenceName, [], providers),
    task: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<{}, {}, never, any>,
      maybeHandler?: WorkflowTaskHandler<{}, {}, never, any>,
    ) =>
      createTask(app as unknown as WorkflowDefinition<string, {}>, taskName, optionsOrHandler as any, maybeHandler as any, {
        providerScope: providers,
      }),
    step: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<{}, {}, never, any>,
      maybeHandler?: WorkflowTaskHandler<{}, {}, never, any>,
    ) =>
      createTask(app as unknown as WorkflowDefinition<string, {}>, taskName, optionsOrHandler as any, maybeHandler as any, {
        providerScope: providers,
      }),
  };

  return app as unknown as WorkflowDefinition<Name, {}>;
}

export function sequence<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  InputContext extends JsonObject = {},
>(name: string): WorkflowSequenceBuilder<Providers, InputContext, InputContext> {
  return workflow(name).sequence<InputContext>(name) as unknown as WorkflowSequenceBuilder<
    Providers,
    InputContext,
    InputContext
  >;
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
    kind: "stoke.provider",
    providerId,
    config,
    plugin,
  };
}

export function isWorkflow(value: unknown): value is WorkflowDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "stoke.workflow");
}

export function isWorkflowNode(value: unknown): value is WorkflowNodeDefinition<any, any, any> {
  return Boolean(value && typeof value === "object" && getKind(value) === "stoke.workflow-node");
}

export function isProviderDefinition(value: unknown): value is WorkflowProviderDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "stoke.provider");
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
  children: readonly WorkflowNodeDefinition<any, any, any>[],
  providers: Providers,
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
    kind: "stoke.workflow-node" as const,
    nodeKind: "sequence" as const,
    name,
    workflow: app,
    cacheScope: nodeOptions.cacheScope,
    config: nodeOptions.config,
    providerScope: providers,
    children,
    workspaceDefinition: workspace,
    operations,
    workspaceOperations,
    task: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any, {
        ...nodeOptions,
        providerScope: providers,
      });
      return createSequence(app, name, [...children, task], providers, workspace, operations, workspaceOperations, nodeOptions);
    },
    step: (
      taskName: string,
      optionsOrHandler: WorkflowTaskOptions | WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
      maybeHandler?: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, any>,
    ) => {
      const task = createTask(app, taskName, optionsOrHandler as any, maybeHandler as any, {
        ...nodeOptions,
        providerScope: providers,
      });
      return createSequence(app, name, [...children, task], providers, workspace, operations, workspaceOperations, nodeOptions);
    },
    addProvider: (providerName: string, provider: WorkflowProviderDefinition<string, any, any>) => {
      validateProvider(providerName, provider);
      const nextProviders = { ...providers, [providerName]: provider };
      return createSequence(
        app as unknown as WorkflowDefinition<string, typeof nextProviders>,
        name,
        children,
        nextProviders,
        workspace as unknown as WorkflowWorkspaceDefinition<typeof nextProviders, OutputContext, any> | undefined,
        operations as unknown as readonly WorkflowOperationDefinition<typeof nextProviders, any>[],
        workspaceOperations as unknown as readonly WorkflowWorkspaceOperationDefinition<
          typeof nextProviders,
          OutputContext,
          WorkspaceData,
          any
        >[],
        nodeOptions,
      );
    },
    removeProvider: (providerName: string) => {
      if (!(providerName in providers)) {
        throw new Error(`Provider ${providerName} is not configured in this scope`);
      }
      const nextProviders = { ...providers } as WorkflowProviderMap;
      delete nextProviders[providerName];
      return createSequence(
        app as unknown as WorkflowDefinition<string, typeof nextProviders>,
        name,
        children,
        nextProviders,
        workspace as unknown as WorkflowWorkspaceDefinition<typeof nextProviders, OutputContext, any> | undefined,
        operations as unknown as readonly WorkflowOperationDefinition<typeof nextProviders, any>[],
        workspaceOperations as unknown as readonly WorkflowWorkspaceOperationDefinition<
          typeof nextProviders,
          OutputContext,
          WorkspaceData,
          any
        >[],
        nodeOptions,
      );
    },
    add: (child: WorkflowNodeDefinition<any, any, any>) => {
      return createSequence(
        app,
        name,
        [...children, attachWorkflowForAuthoring(app, child, providers)],
        providers,
        workspace,
        operations,
        workspaceOperations,
        nodeOptions,
      );
    },
    parallel: (branches: Record<string, WorkflowNodeDefinition<any, any, any>>) => {
      const attachedBranches: Record<string, WorkflowNodeDefinition<any, any, any>> = {};
      for (const [branchName, branch] of Object.entries(branches)) {
        if (!branchName) throw new Error(`Parallel branch names must be non-empty`);
        attachedBranches[branchName] = attachWorkflowForAuthoring(app, branch, providers);
      }

      const parallelNode = createParallel(app, "parallel", attachedBranches, {
        ...nodeOptions,
        providerScope: providers,
      });
      return createSequence(app, name, [...children, parallelNode], providers, workspace, operations, workspaceOperations, nodeOptions);
    },
    workspace: (definition: WorkflowWorkspaceDefinition<Providers, OutputContext, any>) =>
      createSequence(
        app,
        name,
        children,
        providers,
        { ...definition, providerScope: providers },
        operations,
        workspaceOperations,
        nodeOptions,
      ),
    operation: (id: string, options: WorkflowOperationOptions<Providers, any>) => {
      const operation = createOperation(id, options, providers);
      assertUniqueOperationId(operations, operation.id, "Operation");
      return createSequence(app, name, children, providers, workspace, [...operations, operation], workspaceOperations, nodeOptions);
    },
    workspaceOperation: (id: string, options: WorkflowWorkspaceOperationOptions<Providers, OutputContext, any, any>) => {
      const operation = createWorkspaceOperation(id, options, providers);
      assertUniqueOperationId(workspaceOperations, operation.id, "Workspace operation");
      return createSequence(app, name, children, providers, workspace, operations, [...workspaceOperations, operation], nodeOptions);
    },
    global: () =>
      createSequence(app, name, children, providers, workspace, operations, workspaceOperations, {
        ...nodeOptions,
        cacheScope: "global",
      }),
    local: () =>
      createSequence(app, name, children, providers, workspace, operations, workspaceOperations, {
        ...nodeOptions,
        cacheScope: "local",
      }),
    configure: (config: JsonObject) =>
      createSequence(app, name, children, providers, workspace, operations, workspaceOperations, {
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
  providerScope: Providers,
): WorkflowOperationDefinition<Providers, Input> {
  const normalized = id.trim();
  if (!normalized) throw new Error(`Operation ids must be non-empty`);
  if (reservedHostOperationIds.has(normalized)) {
    throw new Error(`Operation id ${normalized} is reserved by the Stoke host`);
  }
  return {
    id: normalized,
    title: options.title,
    description: options.description,
    input: options.input,
    run: options.run,
    providerScope,
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
  providerScope: Providers,
): WorkflowWorkspaceOperationDefinition<Providers, Context, Data, Input> {
  const normalized = id.trim();
  if (!normalized) throw new Error(`Workspace operation ids must be non-empty`);
  if (normalized.includes("/")) throw new Error(`Workspace operation ids cannot contain "/"`);
  if (reservedHostOperationIds.has(normalized)) {
    throw new Error(`Workspace operation id ${normalized} is reserved by the Stoke host`);
  }
  return {
    id: normalized,
    title: options.title,
    description: options.description,
    input: options.input,
    run: options.run,
    providerScope,
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
    kind: "stoke.workflow-node",
    nodeKind: "task",
    name,
    workflow: app,
    cacheScope: nodeOptions.cacheScope,
    config: nodeOptions.config,
    providerScope: nodeOptions.providerScope as Providers | undefined,
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
    kind: "stoke.workflow-node" as const,
    nodeKind: "parallel" as const,
    name,
    workflow: app,
    cacheScope: nodeOptions.cacheScope,
    config: nodeOptions.config,
    providerScope: nodeOptions.providerScope as Providers | undefined,
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

function validateProvider(name: string, provider: WorkflowProviderDefinition): void {
  if (reservedTaskContextKeys.has(name)) {
    throw new Error(`Provider name ${name} is reserved by the task context`);
  }
  if (!isProviderDefinition(provider)) {
    throw new Error(`Provider ${name} is not a valid Stoke provider`);
  }
}

function attachWorkflowForAuthoring<Providers extends WorkflowProviderMap>(
  app: WorkflowDefinition<string, Providers>,
  node: WorkflowNodeDefinition<Providers, any, any>,
  parentProviderScope: WorkflowProviderMap = {},
): WorkflowNodeDefinition<Providers, any, any> {
  const providerScope = mergeProviderScope(parentProviderScope, node.providerScope);
  const workspaceDefinition = node.workspaceDefinition
    ? {
      ...node.workspaceDefinition,
      providerScope: mergeProviderScope(parentProviderScope, node.workspaceDefinition.providerScope),
    }
    : undefined;
  const operations = node.operations?.map((operation) => ({
    ...operation,
    providerScope: mergeProviderScope(parentProviderScope, operation.providerScope),
  }));
  const workspaceOperations = node.workspaceOperations?.map((operation) => ({
    ...operation,
    providerScope: mergeProviderScope(parentProviderScope, operation.providerScope),
  }));
  if (node.workflow === app) {
    return {
      ...node,
      providerScope,
      ...(workspaceDefinition ? { workspaceDefinition } : {}),
      ...(operations ? { operations } : {}),
      ...(workspaceOperations ? { workspaceOperations } : {}),
    } as unknown as WorkflowNodeDefinition<Providers, any, any>;
  }
  if (node.nodeKind === "parallel") {
    return {
      ...node,
      workflow: app,
      providerScope,
      ...(workspaceDefinition ? { workspaceDefinition } : {}),
      ...(operations ? { operations } : {}),
      ...(workspaceOperations ? { workspaceOperations } : {}),
      branches: Object.fromEntries(
        Object.entries(parallelBranchesForAuthoring(node)).map(([name, branch]) => [
          name,
          attachWorkflowForAuthoring(app, branch, parentProviderScope),
        ]),
      ),
    } as unknown as WorkflowNodeDefinition<Providers, any, any>;
  }
  if (node.nodeKind === "sequence") {
    return {
      ...node,
      workflow: app,
      providerScope,
      ...(workspaceDefinition ? { workspaceDefinition } : {}),
      ...(operations ? { operations } : {}),
      ...(workspaceOperations ? { workspaceOperations } : {}),
      children: sequenceChildrenForAuthoring(node).map((child) =>
        attachWorkflowForAuthoring(app, child, parentProviderScope)
      ),
    } as unknown as WorkflowNodeDefinition<Providers, any, any>;
  }
  return {
    ...node,
    workflow: app,
    providerScope,
    ...(workspaceDefinition ? { workspaceDefinition } : {}),
    ...(operations ? { operations } : {}),
    ...(workspaceOperations ? { workspaceOperations } : {}),
  } as WorkflowNodeDefinition<Providers, any, any>;
}

function mergeProviderScope(
  parent: WorkflowProviderMap | undefined,
  child: WorkflowProviderMap | undefined,
): WorkflowProviderMap {
  return {
    ...(parent ?? {}),
    ...(child ?? {}),
  };
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
