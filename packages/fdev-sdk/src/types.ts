export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;

export type EnvResolver = (name: string, fallback?: string) => string;

export type Resolvable<T> = T | (() => MaybePromise<T>);

export type ResolvableObject<T> = {
  [Key in keyof T]: T[Key] extends object
    ? T[Key] extends (...args: any[]) => unknown
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

export type StepCommandOptions = ExecOptions & {
  name?: string;
};

export type VmInspector = {
  readonly vmId: string;
  exec(command: string, options?: StepCommandOptions): Promise<ExecResult>;
  probe(command: string, options?: StepCommandOptions): Promise<ExecResult>;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
};

export type TerminalInteractionOptions = {
  command?: string;
  instructions?: string;
};

export type InteractionRunner = {
  terminal(name: string, options?: TerminalInteractionOptions): Promise<void>;
};

export type SnapshotController = {
  before(name: string, command: string, options?: ExecOptions): Promise<void>;
  metadata(metadata: Record<string, JsonValue>): void;
};

export type StepContextValues = Record<string, JsonValue>;

export type StepContextView<Values extends StepContextValues = StepContextValues> = {
  steps: Readonly<Values>;
};

export type StepRuntimeContext<
  Input = void,
  Context extends StepContextValues = StepContextValues,
> = {
  input: Input;
  vm: VmInspector;
  interact: InteractionRunner;
  snapshot: SnapshotController;
  ctx: StepContextView<Context>;
};

export type StepHandlerResult<Context extends StepContextValues = StepContextValues> =
  | void
  | Context;

export type StepHandler<
  Input = void,
  Context extends StepContextValues = StepContextValues,
  Result extends StepHandlerResult = StepHandlerResult,
> = (
  context: StepRuntimeContext<Input, Context>,
) => MaybePromise<Result>;

export type StepInstance<
  Input = void,
  Context extends StepContextValues = StepContextValues,
> = {
  readonly kind: "fdev.step";
  readonly name: string;
  readonly input: Input;
  readonly dependsOn: readonly StepInstance<any, any>[];
  readonly handler: StepHandler<Input, any, any>;
  readonly __ctx?: Context;
};

export type StepDefinition<
  Input = void,
  Context extends StepContextValues = StepContextValues,
> = StepInstance<Input, Context> &
  ([Input] extends [void]
    ? (input?: Input) => StepInstance<Input, Context>
    : (input: Input) => StepInstance<Input, Context>);

export type StepDefinitionOptions<
  Dependencies extends readonly StepInstance<any, any>[] = readonly StepInstance<any, any>[],
> = {
  dependsOn?: Dependencies;
};

export type StepContextOf<Step> = Step extends StepInstance<any, infer Context extends StepContextValues>
  ? Context
  : never;

export type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export type Simplify<Value> = { [Key in keyof Value]: Value[Key] } & {};

export type DependencyContext<
  Dependencies extends readonly StepInstance<any, any>[],
> = Simplify<UnionToIntersection<StepContextOf<Dependencies[number]>>> extends infer Context
  ? Context extends StepContextValues
    ? Context
    : {}
  : {};

export type StepReturnContext<Return> = Exclude<Awaited<Return>, void | undefined> extends infer Context
  ? [Context] extends [never]
    ? {}
    : Context extends StepContextValues
    ? Context
    : {}
  : {};

export type ProviderWorkspaceContext = object;

export type LocalWorkspaceRuntime = {
  open(target: string): MaybePromise<void>;
};

export type WorkspaceRuntimeRecord = WorkspaceRecord & {
  cwd?: string;
};

export type WorkspaceCreatedContext<
  StepsContext extends StepContextValues = StepContextValues,
  ProviderContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> = {
  vm: VmInspector;
  workspace: WorkspaceRuntimeRecord;
  ctx: {
    steps: Readonly<StepsContext>;
    provider: ProviderContext;
  };
  local: LocalWorkspaceRuntime;
};

export type WorkspaceDefinition<
  StepsContext extends StepContextValues = StepContextValues,
  ProviderContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> = {
  cwd?: string;
  terminals?: string[];
  agents?: Record<string, string>;
  ports?: number[];
  onCreated?: (context: WorkspaceCreatedContext<StepsContext, ProviderContext>) => MaybePromise<void>;
};

export type DevProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> = {
  readonly kind: "fdev.provider";
  providerId: ProviderId;
  config: ResolvableObject<Config>;
  plugin?: unknown;
  readonly __workspaceContext?: WorkspaceContext;
};

export type LoadedProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
> = {
  providerId: ProviderId;
  config: Config;
  plugin?: unknown;
};

export type ProviderWorkspaceContextOf<Provider> =
  Provider extends DevProviderDefinition<any, any, infer WorkspaceContext extends ProviderWorkspaceContext>
    ? WorkspaceContext
    : ProviderWorkspaceContext;

export type MachineStepsContext<
  Steps extends readonly StepInstance<any, any>[],
> = DependencyContext<Steps>;

export type DevMachineDefinition<
  Options = undefined,
  Provider extends DevProviderDefinition = DevProviderDefinition,
  Steps extends readonly StepInstance<any, any>[] = readonly StepInstance<any, any>[],
> = {
  readonly kind: "fdev.machine";
  name: string;
  provider: Provider;
  options?: Options;
  steps:
    | Steps
    | ((context: { options: Options }) => StepInstance<any, any>[]);
  workspace?: WorkspaceDefinition<MachineStepsContext<Steps>, ProviderWorkspaceContextOf<Provider>>;
};

export type LoadedMachine = {
  name: string;
  provider: LoadedProviderDefinition;
  options?: unknown;
  steps: StepInstance<any, any>[];
  workspace?: WorkspaceDefinition;
};

export type PlanStep = {
  index: number;
  name: string;
  input: unknown;
  key: string;
  status: "cached" | "pending";
};

export type MachinePlan = {
  machine: string;
  machineKey: string;
  cachedPrefixLength: number;
  cachedSnapshotId?: string;
  steps: PlanStep[];
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  providerId: string;
  vmId: string;
  machine: string;
  snapshotId: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, JsonValue>;
};

export type DevMachineEvent =
  | { type: "definition.loaded"; machine: string }
  | { type: "plan.created"; machine: string; cachedPrefixLength: number; stepCount: number }
  | { type: "vm.created"; vmId: string; fromSnapshotId?: string }
  | { type: "step.skipped"; step: string; snapshotId: string }
  | { type: "step.started"; step: string }
  | { type: "command.started"; step?: string; commandName: string; command: string }
  | { type: "command.output"; step?: string; commandName: string; stream: "stdout" | "stderr"; data: string }
  | { type: "command.completed"; step?: string; commandName: string; exitCode: number }
  | { type: "interaction.awaiting_user"; step: string; label: string; command?: string; instructions?: string }
  | { type: "interaction.completed"; step: string; label: string }
  | { type: "snapshot.created"; step: string; snapshotId: string }
  | { type: "workspace.ready"; workspaceId: string; vmId: string; snapshotId: string };

export type EventHandler = (event: DevMachineEvent) => void;
