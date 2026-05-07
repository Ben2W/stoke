export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;

export type EnvResolver = (name: string, fallback?: string) => string;

export type Resolvable<T> = T | (() => MaybePromise<T>);

export type ResolvableObject<T> = {
  [Key in keyof T]: T[Key] extends object
    ? T[Key] extends (...args: any[]) => unknown
      ? Resolvable<T[Key]>
      : T[Key] extends readonly unknown[]
        ? Resolvable<T[Key]>
        : ResolvableObject<T[Key]> | Resolvable<T[Key]>
    : Resolvable<T[Key]>;
};

export type ExecOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
};

export type CommandOptions = ExecOptions & {
  name?: string;
};

export type ProviderWorkspaceContext = object;

export type LocalWorkspaceRuntime = {
  open(target: string): MaybePromise<void>;
};

export type WorkflowProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
  Runtime = unknown,
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> = {
  readonly kind: "fdev.provider";
  readonly providerId: ProviderId;
  readonly config: ResolvableObject<Config>;
  readonly plugin?: unknown;
  readonly __runtime?: Runtime;
  readonly __workspaceContext?: WorkspaceContext;
};

export type DevProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
  Runtime = unknown,
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> = WorkflowProviderDefinition<ProviderId, Config, Runtime, WorkspaceContext>;

export type LoadedProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
> = {
  providerId: ProviderId;
  config: Config;
  plugin?: unknown;
};

export type WorkflowProviderMap = Record<string, WorkflowProviderDefinition<string, any, any, any>>;

export type ProviderRuntimeOf<Provider> =
  Provider extends WorkflowProviderDefinition<any, any, infer Runtime, any>
    ? Runtime
    : never;

export type ProviderWorkspaceContextOf<Provider> =
  Provider extends WorkflowProviderDefinition<any, any, any, infer WorkspaceContext extends ProviderWorkspaceContext>
    ? WorkspaceContext
    : ProviderWorkspaceContext;

export type ProviderRuntimeMap<Providers extends WorkflowProviderMap> = {
  readonly [Key in keyof Providers]: ProviderRuntimeOf<Providers[Key]>;
};

export type WorkflowRuntimeHelpers = {
  readonly workflow: string;
  readonly nodePath: string;
  metadata(metadata: JsonObject): void;
};

export type WorkflowTaskRuntime<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
> = ProviderRuntimeMap<Providers> & {
  readonly ctx: Readonly<Context>;
  readonly runtime: WorkflowRuntimeHelpers;
};

export type WorkflowTaskResult = void | undefined | JsonObject;

export type WorkflowTaskHandler<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Result extends WorkflowTaskResult = WorkflowTaskResult,
> = (context: WorkflowTaskRuntime<Providers, Context>) => MaybePromise<Result>;

export type OutputSchema<Output extends JsonObject = JsonObject> =
  | { parse(value: unknown): Output }
  | {
      safeParse(value: unknown):
        | { success: true; data: Output }
        | { success: false; error: unknown };
    };

export type OutputSchemaValue<Schema> =
  Schema extends { parse(value: unknown): infer Output }
    ? Output
    : Schema extends { safeParse(value: unknown): infer Result }
      ? Result extends { success: true; data: infer Output }
        ? Output
        : never
      : never;

export type WorkflowTaskOptions<Output extends JsonObject = JsonObject> = {
  output?: OutputSchema<Output>;
  version?: string;
};

export type WorkflowNodeKind = "task" | "sequence" | "parallel";

export type WorkflowDefinition<
  Name extends string = string,
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
> = {
  readonly kind: "fdev.workflow";
  readonly name: Name;
  readonly providers: Providers;

  sequence<InputContext extends JsonObject = {}>(name: string): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    InputContext
  >;

  task<Result extends WorkflowTaskResult>(
    name: string,
    handler: WorkflowTaskHandler<Providers, {}, Result>,
  ): WorkflowTaskNode<Providers, {}, TaskReturnContext<Result>>;

  task<Schema extends OutputSchema<JsonObject>, Result extends MaybePromise<OutputSchemaValue<Schema> | void>>(
    name: string,
    options: WorkflowTaskOptions<OutputSchemaValue<Schema>>,
    handler: WorkflowTaskHandler<Providers, {}, Awaited<Result> & WorkflowTaskResult>,
  ): WorkflowTaskNode<Providers, {}, TaskReturnContext<Result>>;
};

export type WorkflowNodeDefinition<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  InputContext extends JsonObject = JsonObject,
  OutputContext extends JsonObject = JsonObject,
> = {
  readonly kind: "fdev.workflow-node";
  readonly nodeKind: WorkflowNodeKind;
  readonly name: string;
  readonly workflow: WorkflowDefinition<string, Providers>;
  readonly workspaceDefinition?: WorkflowWorkspaceDefinition<Providers, OutputContext>;
  readonly __providers?: Providers;
  readonly __input?: InputContext;
  readonly __output?: OutputContext;
};

export type WorkflowTaskNode<
  Providers extends WorkflowProviderMap,
  InputContext extends JsonObject,
  OutputContext extends JsonObject,
> = WorkflowNodeDefinition<Providers, InputContext, OutputContext> & {
  readonly nodeKind: "task";
  readonly options?: WorkflowTaskOptions;
  readonly handler: WorkflowTaskHandler<Providers, InputContext, any>;
};

export type WorkflowSequenceBuilder<
  Providers extends WorkflowProviderMap,
  InputContext extends JsonObject,
  OutputContext extends JsonObject,
> = WorkflowNodeDefinition<Providers, InputContext, OutputContext> & {
  readonly nodeKind: "sequence";
  readonly children: readonly WorkflowNodeDefinition<Providers, any, any>[];

  task<Result extends WorkflowTaskResult>(
    name: string,
    handler: WorkflowTaskHandler<Providers, OutputContext, Result>,
  ): WorkflowSequenceBuilder<Providers, InputContext, Merge<OutputContext, TaskReturnContext<Result>>>;

  task<Schema extends OutputSchema<JsonObject>, Result extends MaybePromise<OutputSchemaValue<Schema> | void>>(
    name: string,
    options: WorkflowTaskOptions<OutputSchemaValue<Schema>>,
    handler: WorkflowTaskHandler<Providers, OutputContext, Awaited<Result> & WorkflowTaskResult>,
  ): WorkflowSequenceBuilder<Providers, InputContext, Merge<OutputContext, TaskReturnContext<Result>>>;

  add<Node extends WorkflowNodeDefinition<Providers, any, any>>(
    node: OutputContext extends WorkflowNodeInput<Node> ? Node : never,
  ): WorkflowSequenceBuilder<Providers, InputContext, Merge<OutputContext, WorkflowNodeOutput<Node>>>;

  parallel<const Branches extends Record<string, WorkflowNodeDefinition<Providers, any, any>>>(
    branches: {
      readonly [Key in keyof Branches]: OutputContext extends WorkflowNodeInput<Branches[Key]>
        ? Branches[Key]
        : never;
    },
  ): WorkflowSequenceBuilder<Providers, InputContext, Merge<OutputContext, ParallelOutput<Branches>>>;

  workspace(
    definition: WorkflowWorkspaceDefinition<Providers, OutputContext>,
  ): WorkflowNodeDefinition<Providers, InputContext, OutputContext>;
};

export type WorkflowNodeInput<Node> =
  Node extends WorkflowNodeDefinition<any, infer Input extends JsonObject, any>
    ? Input
    : never;

export type WorkflowNodeOutput<Node> =
  Node extends WorkflowNodeDefinition<any, any, infer Output extends JsonObject>
    ? Output
    : never;

export type ParallelOutput<Branches extends Record<string, WorkflowNodeDefinition<any, any, any>>> = {
  [Key in keyof Branches & string]: WorkflowNodeOutput<Branches[Key]>;
};

export type TaskReturnContext<Return> = Exclude<Awaited<Return>, void | undefined> extends infer Context
  ? [Context] extends [never]
    ? {}
    : Context extends JsonObject
      ? Context
      : never
  : {};

export type Merge<Left extends JsonObject, Right extends JsonObject> =
  Simplify<Omit<Left, keyof Right> & Right>;

export type Simplify<Value> = { [Key in keyof Value]: Value[Key] } & {};

export type WorkflowWorkspaceDefinition<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Context extends JsonObject = JsonObject,
> = {
  source?: (ctx: Readonly<Context>) => JsonValue;
  cwd?: string | ((ctx: Readonly<Context>) => string | undefined);
  ports?: readonly number[];
  onCreated?: (context: WorkflowWorkspaceCreatedContext<Providers, Context>) => MaybePromise<void>;
  onOpen?: (context: WorkflowWorkspaceOpenContext<Providers, Context>) => MaybePromise<void>;
};

export type WorkflowWorkspaceCreatedContext<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Context extends JsonObject = JsonObject,
> = WorkflowWorkspaceLifecycleContext<Providers, Context>;

export type WorkflowWorkspaceOpenContext<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Context extends JsonObject = JsonObject,
> = WorkflowWorkspaceLifecycleContext<Providers, Context>;

export type WorkflowWorkspaceLifecycleContext<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Context extends JsonObject = JsonObject,
> = {
  workspace: WorkspaceRuntimeRecord;
  ctx: Readonly<Context>;
  providers: ProviderRuntimeMap<Providers>;
  providerContext: ProviderWorkspaceContext;
  local: LocalWorkspaceRuntime;
};

export type LoadedWorkflow = {
  name: string;
  providers: Record<string, LoadedProviderDefinition>;
  root: WorkflowNodeDefinition<any, any, any>;
  workspace?: WorkflowWorkspaceDefinition<any, any>;
};

export type WorkflowPlanNode = {
  index: number;
  path: string;
  name: string;
  status: "cached" | "pending";
  reason?: string;
  runId?: string;
  upstreamRunIds: string[];
};

export type WorkflowPlan = {
  workflow: string;
  providerFingerprint: string;
  cachedNodeCount: number;
  nodeCount: number;
  nodes: WorkflowPlanNode[];
  finalContext?: Record<string, JsonValue>;
};

export type MachinePlan = WorkflowPlan;

export type WorkspaceRecord = {
  id: string;
  name: string;
  providerId: string;
  workflow: string;
  resourceId: string;
  snapshotId?: string;
  sourceRef: JsonValue;
  context: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, JsonValue>;
};

export type WorkspaceRuntimeRecord = WorkspaceRecord & {
  cwd?: string;
};

export type WorkflowEvent =
  | { type: "definition.loaded"; workflow: string }
  | { type: "plan.created"; workflow: string; cachedNodeCount: number; nodeCount: number }
  | { type: "node.cached"; nodePath: string; runId: string }
  | { type: "node.started"; nodePath: string }
  | { type: "vm.created"; providerId: string; vmId: string; fromSnapshotId?: string }
  | { type: "command.started"; nodePath?: string; commandName: string; command: string }
  | { type: "command.output"; nodePath?: string; commandName: string; stream: "stdout" | "stderr"; data: string }
  | { type: "command.completed"; nodePath?: string; commandName: string; exitCode: number }
  | {
      type: "interaction.awaiting_user";
      nodePath: string;
      interactionId: string;
      label: string;
      title: string;
      url: string;
      instructions?: string;
    }
  | {
      type: "interaction.completed";
      nodePath: string;
      interactionId: string;
      label: string;
      title: string;
    }
  | { type: "artifact.created"; nodePath: string; providerId: string; kind: string; ref: JsonValue }
  | { type: "workspace.ready"; workspaceId: string; providerId: string; resourceId: string; snapshotId?: string };

export type DevMachineEvent = WorkflowEvent;

export type EventHandler = (event: WorkflowEvent) => void;
