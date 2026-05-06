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

export type InteractionRunner = {
  terminal(name: string, options?: { command?: string; instructions?: string }): Promise<void>;
};

export type SnapshotController = {
  before(name: string, command: string, options?: ExecOptions): Promise<void>;
  metadata(metadata: Record<string, JsonValue>): void;
};

export type StepContextValues = Record<string, JsonValue>;

export type StepContextStore<Values extends StepContextValues = StepContextValues> = {
  get: {
    <Key extends keyof Values & string>(key: Key): Values[Key];
    <T = unknown>(key: string): T | undefined;
  };
  require: {
    <Key extends keyof Values & string>(key: Key): Values[Key];
    <T = unknown>(key: string): T;
  };
  set(key: string, value: JsonValue): void;
};

export type StepRuntimeContext<
  Input = void,
  Context extends StepContextValues = StepContextValues,
> = {
  input: Input;
  vm: VmInspector;
  interact: InteractionRunner;
  snapshot: SnapshotController;
  ctx: StepContextStore<Context>;
};

export type StepHandlerResult<Context extends StepContextValues = StepContextValues> =
  | void
  | { ctx?: Context };

export type StepHandler<
  Input = void,
  Context extends StepContextValues = StepContextValues,
  Result = StepHandlerResult,
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

export type StepReturnContext<Return> = Awaited<Return> extends { ctx?: infer Context }
  ? Context extends StepContextValues
    ? Context
    : {}
  : {};

export type MachineResources = {
  cpu?: number;
  memory?: string | number;
  disk?: string | number;
  idleTimeoutSeconds?: number | null;
};

export type DevProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
> = {
  readonly kind: "fdev.provider";
  providerId: ProviderId;
  config: ResolvableObject<Config>;
  plugin?: unknown;
};

export type LoadedProviderDefinition<
  ProviderId extends string = string,
  Config extends object = Record<string, unknown>,
> = {
  providerId: ProviderId;
  config: Config;
  plugin?: unknown;
};

export type DevMachineDefinition<Options = undefined> = MachineResources & {
  readonly kind: "fdev.machine";
  name: string;
  provider: DevProviderDefinition;
  image: string;
  options?: Options;
  steps:
    | StepInstance<any, any>[]
    | ((context: { options: Options }) => StepInstance<any, any>[]);
  workspace?: {
    cwd?: string;
    terminals?: string[];
    agents?: Record<string, string>;
    ports?: number[];
  };
};

export type LoadedMachine = MachineResources & {
  name: string;
  provider: LoadedProviderDefinition;
  image: string;
  options?: unknown;
  steps: StepInstance<any, any>[];
  workspace?: DevMachineDefinition<any>["workspace"];
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
