export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;

export type EnvResolver = {
  (name: string, fallback?: string): string;
  secret(name: string, fallback?: string): string;
};

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

export type ExecOutputStream = "stdout" | "stderr";

export type ExecOutputChunk = {
  stream: ExecOutputStream;
  data: string;
};

export type ExecOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  onOutput?: (chunk: ExecOutputChunk) => MaybePromise<void>;
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

export type LocalWorkspaceRuntime = {
  open(target: string): MaybePromise<void>;
  prompt?: LocalPromptRuntime;
  command?(input: LocalCommandRequest): MaybePromise<LocalCommandResult>;
  requestCapability?<Result = unknown>(
    capability: string,
    params: unknown,
    options?: LocalHostCapabilityRequestOptions,
  ): MaybePromise<Result>;
  requestCapabilitySession?<Result = unknown>(
    capability: string,
    params: unknown,
    options?: LocalHostCapabilityRequestOptions,
  ): MaybePromise<HostCapabilitySession<Result>>;
};

export type LocalPromptRuntime = {
  message(input: LocalMessageRequest): MaybePromise<void>;
  text(input: LocalTextRequest): MaybePromise<string>;
  confirm(input: LocalConfirmRequest): MaybePromise<boolean>;
  select(input: LocalSelectRequest): MaybePromise<string>;
};

export type LocalMessageRequest = {
  message: string;
  level?: "info" | "warn" | "error";
};

export type LocalTextRequest = {
  message: string;
  defaultValue?: string;
};

export type LocalConfirmRequest = {
  message: string;
  defaultValue?: boolean;
};

export type LocalSelectRequest = {
  message: string;
  options: Array<{
    value: string;
    label?: string;
    description?: string;
  }>;
  defaultValue?: string;
};

export type LocalHostCapabilityRequestOptions = {
  nodePath?: string;
};

export type HostCapabilitySession<Result = unknown> = {
  result: Result;
  closed: Promise<void>;
};

export type LocalCommandRequest = {
  argv: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | null;
  mode?: "capture" | "interactive";
  reason?: string;
  presentation?: {
    visible?: boolean;
    label?: string;
  };
};

export type LocalCommandResult = {
  exitCode: number;
  stdout: string | null;
  stderr: string | null;
};

export type WorkflowLogStream = "stdout" | "stderr" | "info" | "debug" | "warn";

export type WorkflowProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
  Runtime = unknown,
> = {
  readonly kind: "stoke.provider";
  readonly providerId: ProviderId;
  readonly config: ResolvableObject<Config>;
  readonly plugin?: unknown;
  readonly __runtime?: Runtime;
};

export type HostCapabilityRequirement = {
  readonly id: string;
  readonly schemaHash?: string;
};

export type DevProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
  Runtime = unknown,
> = WorkflowProviderDefinition<ProviderId, Config, Runtime>;

export type LoadedProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
> = {
  providerId: ProviderId;
  config: Config;
  plugin?: unknown;
};

export type WorkflowProviderMap = Record<string, WorkflowProviderDefinition<string, any, any>>;

export type ProviderRuntimeOf<Provider> =
  Provider extends WorkflowProviderDefinition<any, any, infer Runtime>
    ? Runtime
    : never;

export type ProviderRuntimeMap<Providers extends WorkflowProviderMap> = {
  readonly [Key in keyof Providers]: ProviderRuntimeOf<Providers[Key]>;
};

export type MergeProviderMap<
  Providers extends WorkflowProviderMap,
  Name extends string,
  Provider extends WorkflowProviderDefinition<string, any, any>,
> = Simplify<Omit<Providers, Name> & { readonly [Key in Name]: Provider }>;

export type WorkflowRuntimeHelpers = {
  readonly workflow: string;
  readonly nodePath: string;
  metadata(metadata: JsonObject): void;
};

export const STEP_INVALIDATION_KIND = "stoke.step.invalidate" as const;

export type WorkflowStepInvalidation<Target extends string = string> = {
  readonly kind: typeof STEP_INVALIDATION_KIND;
  readonly target: Target;
  readonly targetNodePath: string;
};

export type WorkflowStepRuntime<
  Context extends JsonObject = JsonObject,
  PreviousTaskIds extends string = string,
> = WorkflowRuntimeHelpers & {
  readonly ctx: Readonly<Context>;
  invalidate<const Target extends PreviousTaskIds>(target: Target): never;
};

export type WorkflowTaskContextResult<Context extends JsonObject = JsonObject> = {
  readonly ctx: Context;
};

export type WorkflowTaskRuntime<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  PreviousTaskIds extends string = string,
  Config extends JsonObject = JsonObject,
> = {
  readonly providers: ProviderRuntimeMap<Providers>;
  readonly step: WorkflowStepRuntime<Context, PreviousTaskIds>;
  readonly config: Readonly<Config>;
};

export type WorkflowTaskResult =
  | void
  | undefined
  | WorkflowTaskContextResult<JsonObject>
  | WorkflowStepInvalidation<string>;

export type WorkflowTaskHandler<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  PreviousTaskIds extends string = string,
  Result extends WorkflowTaskResult = WorkflowTaskResult,
  Config extends JsonObject = JsonObject,
> = (context: WorkflowTaskRuntime<Providers, Context, PreviousTaskIds, Config>) => MaybePromise<Result>;

export type WorkflowInputFieldKind = "workspace" | "string" | "boolean" | "number";

export type WorkflowInputFieldDefinition<Value = unknown> = {
  readonly kind: WorkflowInputFieldKind;
  readonly name: string;
  readonly description?: string;
  readonly position?: number;
  readonly required?: boolean;
  readonly defaultValue?: Value;
  readonly __value?: Value;
};

export type WorkflowOperationInputSchema<Input extends object = object> = {
  parse(value: unknown): Input;
  toJSONSchema(params?: {
    target?: "draft-04" | "draft-07" | "draft-2020-12" | "openapi-3.0" | (string & {});
    io?: "input" | "output";
    unrepresentable?: "throw" | "any";
  }): Record<string, unknown>;
};

export type WorkflowOperationRuntime<
  Providers extends WorkflowProviderMap,
  Input extends object,
> = {
  readonly input: Readonly<Input>;
  readonly providers: ProviderRuntimeMap<Providers>;
  readonly local: LocalWorkspaceRuntime;
  readonly workflow: string;
  readonly step: WorkflowStepRuntime;
};

export type WorkflowOperationResult = void | undefined | JsonValue;

export type WorkflowOperationHandler<
  Providers extends WorkflowProviderMap,
  Input extends object,
  Result extends WorkflowOperationResult = WorkflowOperationResult,
> = (context: WorkflowOperationRuntime<Providers, Input>) => MaybePromise<Result>;

export type WorkflowRuntimeContext<Context extends JsonObject> = {
  readonly name: string;
  readonly ctx: Readonly<Context>;
};

export type ReadonlyWorkspaceContext<Context extends JsonObject> = {
  readonly [Key in keyof Context]: Context[Key];
};

export type WorkspaceCreateRuntimeRecord = {
  readonly name: string;
};

export type WorkspaceRuntimeRecord<Context extends object = JsonObject> = {
  readonly name: string;
  readonly ctx: Context;
};

export type WorkflowWorkspaceCreateRuntime<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
> = {
  readonly workflow: WorkflowRuntimeContext<Context>;
  readonly workspace: WorkspaceCreateRuntimeRecord;
  readonly providers: ProviderRuntimeMap<Providers>;
  readonly local: LocalWorkspaceRuntime;
  readonly step: WorkflowStepRuntime;
};

export type WorkflowWorkspaceCreateHandler<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends JsonObject,
> = (context: WorkflowWorkspaceCreateRuntime<Providers, Context>) => MaybePromise<Data>;

export type WorkflowWorkspaceRemoveRuntime<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends JsonObject,
> = {
  readonly workflow: WorkflowRuntimeContext<Context>;
  readonly workspace: WorkspaceRuntimeRecord<ReadonlyWorkspaceContext<Data>>;
  readonly providers: ProviderRuntimeMap<Providers>;
  readonly local: LocalWorkspaceRuntime;
  readonly step: WorkflowStepRuntime;
};

export type WorkflowWorkspaceRemoveHandler<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends JsonObject,
> = (context: WorkflowWorkspaceRemoveRuntime<Providers, Context, Data>) => MaybePromise<void>;

export type WorkflowWorkspaceOperationRuntime<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends object,
  Input extends object,
> = {
  readonly workflow: WorkflowRuntimeContext<Context>;
  readonly input: Readonly<Input>;
  readonly workspace: WorkspaceRuntimeRecord<Data>;
  readonly providers: ProviderRuntimeMap<Providers>;
  readonly local: LocalWorkspaceRuntime;
  readonly step: WorkflowStepRuntime;
};

export type WorkflowWorkspaceOperationHandler<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends object,
  Input extends object,
  Result extends WorkflowOperationResult = WorkflowOperationResult,
> = (context: WorkflowWorkspaceOperationRuntime<Providers, Context, Data, Input>) => MaybePromise<Result>;

export type WorkflowOperationOptions<
  Providers extends WorkflowProviderMap,
  Input extends object = {},
> = {
  title?: string;
  description?: string;
  input?: WorkflowOperationInputSchema<Input>;
  run: WorkflowOperationHandler<Providers, Input>;
};

export type WorkflowOperationDefinition<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Input extends object = object,
> = {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly input?: WorkflowOperationInputSchema<Input>;
  readonly run: WorkflowOperationHandler<Providers, Input>;
  readonly providerScope?: Providers;
};

export type WorkflowWorkspaceOperationOptions<
  Providers extends WorkflowProviderMap,
  Context extends JsonObject,
  Data extends object,
  Input extends object = {},
> = {
  title?: string;
  description?: string;
  input?: WorkflowOperationInputSchema<Input>;
  run: WorkflowWorkspaceOperationHandler<Providers, Context, Data, Input>;
};

export type WorkflowWorkspaceOperationDefinition<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Context extends JsonObject = JsonObject,
  Data extends object = JsonObject,
  Input extends object = object,
> = {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly input?: WorkflowOperationInputSchema<Input>;
  readonly run: WorkflowWorkspaceOperationHandler<Providers, Context, Data, Input>;
  readonly providerScope?: Providers;
};

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
  cacheTTL?: WorkflowTaskCacheTTL;
};

export type WorkflowTaskCacheTTL =
  | number
  | string
  | {
      seconds?: number;
      minutes?: number;
      hours?: number;
      days?: number;
    };

export type WorkflowNodeKind = "task" | "sequence" | "parallel";
export type WorkflowCacheScope = "local" | "global";

export type WorkflowDefinition<
  Name extends string = string,
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
> = {
  readonly kind: "stoke.workflow";
  readonly name: Name;
  readonly providers: Providers;

  sequence<InputContext extends JsonObject = {}>(name: string): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    InputContext,
    JsonObject,
    never,
    never,
    never
  >;

  task<Result extends WorkflowTaskResult>(
    name: string,
    handler: WorkflowTaskHandler<Providers, {}, never, Result>,
  ): WorkflowTaskNode<Providers, {}, TaskReturnContext<Result>>;

  task<
    Schema extends OutputSchema<JsonObject>,
    Result extends MaybePromise<WorkflowTaskContextResult<OutputSchemaValue<Schema>> | WorkflowStepInvalidation<string> | void>,
  >(
    name: string,
    options: WorkflowTaskOptions<OutputSchemaValue<Schema>>,
    handler: WorkflowTaskHandler<Providers, {}, never, Awaited<Result> & WorkflowTaskResult>,
  ): WorkflowTaskNode<Providers, {}, TaskReturnContext<Result>>;

  step<Result extends WorkflowTaskResult>(
    name: string,
    handler: WorkflowTaskHandler<Providers, {}, never, Result>,
  ): WorkflowTaskNode<Providers, {}, TaskReturnContext<Result>>;

  step<
    Schema extends OutputSchema<JsonObject>,
    Result extends MaybePromise<WorkflowTaskContextResult<OutputSchemaValue<Schema>> | WorkflowStepInvalidation<string> | void>,
  >(
    name: string,
    options: WorkflowTaskOptions<OutputSchemaValue<Schema>>,
    handler: WorkflowTaskHandler<Providers, {}, never, Awaited<Result> & WorkflowTaskResult>,
  ): WorkflowTaskNode<Providers, {}, TaskReturnContext<Result>>;
};

export type WorkflowNodeDefinition<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  InputContext extends JsonObject = JsonObject,
  OutputContext extends JsonObject = JsonObject,
> = {
  readonly kind: "stoke.workflow-node";
  readonly nodeKind: WorkflowNodeKind;
  readonly name: string;
  readonly workflow: WorkflowDefinition<string, Providers>;
  readonly cacheScope?: WorkflowCacheScope;
  readonly config?: JsonObject;
  readonly providerScope?: Providers;
  readonly workspaceDefinition?: WorkflowWorkspaceDefinition<Providers, OutputContext>;
  readonly operations?: readonly WorkflowOperationDefinition<Providers, any>[];
  readonly workspaceOperations?: readonly WorkflowWorkspaceOperationDefinition<Providers, OutputContext, any, any>[];
  readonly __providers?: Providers;
  readonly __input?: InputContext;
  readonly __output?: OutputContext;
};

export type WorkflowTaskNode<
  Providers extends WorkflowProviderMap,
  InputContext extends JsonObject,
  OutputContext extends JsonObject,
  Config extends JsonObject = {},
> = WorkflowNodeDefinition<Providers, InputContext, OutputContext> & {
  readonly nodeKind: "task";
  readonly options?: WorkflowTaskOptions;
  readonly handler: WorkflowTaskHandler<Providers, InputContext, string, any, Config>;

  global(): WorkflowTaskNode<Providers, InputContext, OutputContext, Config>;
  local(): WorkflowTaskNode<Providers, InputContext, OutputContext, Config>;
  configure<const NextConfig extends JsonObject>(
    config: NextConfig,
  ): WorkflowTaskNode<Providers, InputContext, OutputContext, Merge<Config, NextConfig>>;
};

export type WorkflowSequenceBuilder<
  Providers extends WorkflowProviderMap,
  InputContext extends JsonObject,
  OutputContext extends JsonObject,
  WorkspaceData extends object = JsonObject,
  OperationIds extends string = never,
  WorkspaceOperationIds extends string = never,
  PreviousTaskIds extends string = never,
  Config extends JsonObject = {},
> = WorkflowNodeDefinition<Providers, InputContext, OutputContext> & {
  readonly nodeKind: "sequence";
  readonly children: readonly WorkflowNodeDefinition<any, any, any>[];

  addProvider<
    const Name extends string,
    Provider extends WorkflowProviderDefinition<string, any, any>,
  >(
    name: Name,
    provider: Provider,
  ): WorkflowSequenceBuilder<
    MergeProviderMap<Providers, Name, Provider>,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  removeProvider<const Name extends keyof Providers & string>(
    name: Name,
  ): WorkflowSequenceBuilder<
    Simplify<Omit<Providers, Name>>,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  task<const Id extends string, Result extends WorkflowTaskResult>(
    name: Id & WorkflowTaskIdConstraint<Id, PreviousTaskIds>,
    handler: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, Result, Config>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    TaskReturnContext<Result>,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds | Id,
    Config
  >;

  task<
    const Id extends string,
    Schema extends OutputSchema<JsonObject>,
    Result extends MaybePromise<WorkflowTaskContextResult<OutputSchemaValue<Schema>> | WorkflowStepInvalidation<string> | void>,
  >(
    name: Id & WorkflowTaskIdConstraint<Id, PreviousTaskIds>,
    options: WorkflowTaskOptions<OutputSchemaValue<Schema>>,
    handler: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, Awaited<Result> & WorkflowTaskResult, Config>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    TaskReturnContext<Result>,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds | Id,
    Config
  >;

  step<const Id extends string, Result extends WorkflowTaskResult>(
    name: Id & WorkflowTaskIdConstraint<Id, PreviousTaskIds>,
    handler: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, Result, Config>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    TaskReturnContext<Result>,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds | Id,
    Config
  >;

  step<
    const Id extends string,
    Schema extends OutputSchema<JsonObject>,
    Result extends MaybePromise<WorkflowTaskContextResult<OutputSchemaValue<Schema>> | WorkflowStepInvalidation<string> | void>,
  >(
    name: Id & WorkflowTaskIdConstraint<Id, PreviousTaskIds>,
    options: WorkflowTaskOptions<OutputSchemaValue<Schema>>,
    handler: WorkflowTaskHandler<Providers, OutputContext, PreviousTaskIds, Awaited<Result> & WorkflowTaskResult, Config>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    TaskReturnContext<Result>,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds | Id,
    Config
  >;

  add<Node extends WorkflowNodeDefinition<any, any, any>>(
    node: OutputContext extends WorkflowNodeInput<Node> ? Node : never,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    WorkflowNodeOutput<Node>,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  parallel<const Branches extends Record<string, WorkflowNodeDefinition<any, any, any>>>(
    branches: {
      readonly [Key in keyof Branches]: OutputContext extends WorkflowNodeInput<Branches[Key]>
        ? Branches[Key]
        : never;
    },
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    Merge<OutputContext, ParallelOutput<Branches>>,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  workspace<Data extends JsonObject>(
    definition: WorkflowWorkspaceDefinition<Providers, OutputContext, Data>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    ReadonlyWorkspaceContext<Data>,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  operation<const Id extends string, Input extends object = {}>(
    id: Id & WorkflowOperationIdConstraint<Id, OperationIds>,
    options: WorkflowOperationOptions<Providers, Input>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds | Id,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  workspaceOperation<const Id extends string, Input extends object = {}>(
    id: Id & WorkflowOperationIdConstraint<Id, WorkspaceOperationIds>,
    options: WorkflowWorkspaceOperationOptions<Providers, OutputContext, WorkspaceData, Input>,
  ): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds | Id,
    PreviousTaskIds,
    Config
  >;

  global(): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  local(): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Config
  >;

  configure<const NextConfig extends JsonObject>(config: NextConfig): WorkflowSequenceBuilder<
    Providers,
    InputContext,
    OutputContext,
    WorkspaceData,
    OperationIds,
    WorkspaceOperationIds,
    PreviousTaskIds,
    Merge<Config, NextConfig>
  >;
};

export const RESERVED_WORKFLOW_OPERATION_IDS = [
  "apply",
  "completion",
  "create",
  "doctor",
  "fork",
  "help",
  "init",
  "ls",
  "plan",
  "projects",
  "remove",
  "run",
  "version",
] as const;

export type ReservedWorkflowOperationId = typeof RESERVED_WORKFLOW_OPERATION_IDS[number];

type WorkflowOperationIdError<Message extends string> = {
  readonly __stokeOperationIdError: Message;
};

export type WorkflowOperationIdConstraint<
  Id extends string,
  Existing extends string,
> = string extends Id
  ? unknown
  : Id extends Existing
    ? WorkflowOperationIdError<`Operation id "${Id}" is already defined`>
    : Id extends ReservedWorkflowOperationId
      ? WorkflowOperationIdError<`Operation id "${Id}" is reserved by Stoke`>
      : Id extends `${string}/${string}`
        ? WorkflowOperationIdError<`Operation id "${Id}" cannot contain "/"`>
        : unknown;

type WorkflowTaskIdError<Message extends string> = {
  readonly __stokeTaskIdError: Message;
};

export type WorkflowTaskIdConstraint<
  Id extends string,
  Existing extends string,
> = string extends Id
  ? unknown
  : Id extends Existing
    ? WorkflowTaskIdError<`Task id "${Id}" is already defined`>
    : Id extends ""
      ? WorkflowTaskIdError<"Task ids must be non-empty">
      : unknown;

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

export type TaskReturnContext<Return> =
  Exclude<Awaited<Return>, void | undefined | WorkflowStepInvalidation<string>> extends infer Result
    ? [Result] extends [never]
      ? {}
      : Result extends { ctx: infer Context extends JsonObject }
        ? Simplify<Context>
        : never
    : {};

export type Merge<Left extends JsonObject, Right extends JsonObject> =
  Simplify<Omit<Left, keyof Right> & Right>;

export type Simplify<Value> = { [Key in keyof Value]: Value[Key] } & {};

export type WorkflowWorkspaceDefinition<
  Providers extends WorkflowProviderMap = WorkflowProviderMap,
  Context extends JsonObject = JsonObject,
  Data extends JsonObject = JsonObject,
> = {
  create: WorkflowWorkspaceCreateHandler<Providers, Context, Data>;
  remove: WorkflowWorkspaceRemoveHandler<Providers, Context, Data>;
  readonly providerScope?: Providers;
};

export type LoadedWorkflow = {
  name: string;
  providers: Record<string, LoadedProviderDefinition>;
  root: WorkflowNodeDefinition<any, any, any>;
  workspace?: WorkflowWorkspaceDefinition<any, any, any>;
  operations: readonly WorkflowOperationDefinition<any, any>[];
  workspaceOperations: readonly WorkflowWorkspaceOperationDefinition<any, any, any, any>[];
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

export type WorkflowProviderCheckStatus = "ok" | "required";

export type WorkflowProviderCheck = {
  providerId: string;
  providerName: string;
  id: string;
  label: string;
  status: WorkflowProviderCheckStatus;
  value: string;
  message?: string;
  detail?: string;
  fingerprint?: string;
  metadata?: JsonObject;
};

export type WorkflowProviderCheckResult =
  & Omit<WorkflowProviderCheck, "providerId" | "providerName">
  & Partial<Pick<WorkflowProviderCheck, "providerId" | "providerName">>;

export type WorkflowPlan = {
  workflow: string;
  providerFingerprint: string;
  providerChecks?: WorkflowProviderCheck[];
  cachedNodeCount: number;
  nodeCount: number;
  nodes: WorkflowPlanNode[];
  finalContext?: Record<string, JsonValue>;
};

export type MachinePlan = WorkflowPlan;

export type WorkspaceRecord = {
  id: string;
  name: string;
  workflow: string;
  workflowCtx: Record<string, JsonValue>;
  ctx: Record<string, JsonValue>;
  createdFrom?:
    | { kind: "checkout"; deviceId: string; checkoutId?: string }
    | { kind: "dashboard" };
  createdAt: string;
  updatedAt: string;
};

export type WorkflowEvent =
  | { type: "definition.loaded"; workflow: string }
  | { type: "plan.created"; workflow: string; cachedNodeCount: number; nodeCount: number }
  | { type: "node.cached"; nodePath: string; runId: string }
  | { type: "node.started"; nodePath: string }
  | { type: "node.completed"; nodePath: string; runId: string }
  | { type: "vm.created"; providerId: string; vmId: string; fromSnapshotId?: string }
  | { type: "command.started"; nodePath?: string; commandName: string; command: string }
  | { type: "command.output"; nodePath?: string; commandName: string; stream: ExecOutputStream; data: string }
  | { type: "command.completed"; nodePath?: string; commandName: string; exitCode: number }
  | { type: "log.output"; nodePath: string; stream: WorkflowLogStream; label?: string; data: string }
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
  | { type: "workflow.apply.started"; workflow: string }
  | { type: "workflow.apply.completed"; workflow: string; nodeCount: number; cachedNodeCount: number; durationMs: number }
  | { type: "workspace.create.started"; workspaceName: string }
  | { type: "workspace.ready"; workspaceId: string }
  | { type: "workspace.remove.started"; workspaceName: string }
  | { type: "workspace.remove.completed"; workspaceName: string }
  | { type: "workspace.operation.started"; workspaceName: string; operationId: string }
  | { type: "workspace.operation.completed"; workspaceName: string; operationId: string };

export type DevMachineEvent = WorkflowEvent;

export type EventHandler = (event: WorkflowEvent) => void;
