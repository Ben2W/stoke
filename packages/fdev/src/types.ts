export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;

export type EnvResolver = (name: string, fallback?: string) => string;

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

export type VmInspector = {
  readonly vmId: string;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
};

export type StepRunner = {
  run(name: string, command: string, options?: ExecOptions): Promise<ExecResult>;
  assert(name: string, predicate: (context: MigrationRuntimeContext<any>) => MaybePromise<boolean>): Promise<void>;
};

export type InteractionRunner = {
  terminal(name: string, options?: { command?: string; instructions?: string }): Promise<void>;
};

export type SnapshotController = {
  before(name: string, command: string, options?: ExecOptions): Promise<void>;
  metadata(metadata: Record<string, JsonValue>): void;
};

export type MigrationRuntimeContext<Input = void> = {
  input: Input;
  vm: VmInspector;
  step: StepRunner;
  interact: InteractionRunner;
  snapshot: SnapshotController;
  get<T = unknown>(key: string): T | undefined;
  require<T = unknown>(key: string): T;
  set(key: string, value: JsonValue): void;
};

export type MigrationHandler<Input = void> = (
  context: MigrationRuntimeContext<Input>,
) => MaybePromise<void>;

export type MigrationInstance<Input = void> = {
  readonly kind: "fdev.migration";
  readonly name: string;
  readonly input: Input;
  readonly handler: MigrationHandler<Input>;
};

export type MigrationDefinition<Input = void> = MigrationInstance<Input> &
  ((input: Input) => MigrationInstance<Input>);

export type MachineResources = {
  cpu?: number;
  memory?: string | number;
  disk?: string | number;
  idleTimeoutSeconds?: number | null;
};

export type DevMachineDefinition<Options = undefined> = MachineResources & {
  readonly kind: "fdev.machine";
  name: string;
  apiKey: string | (() => MaybePromise<string>);
  image: string;
  options?: Options;
  migrations:
    | MigrationInstance<any>[]
    | ((context: { options: Options }) => MigrationInstance<any>[]);
  workspace?: {
    cwd?: string;
    terminals?: string[];
    agents?: Record<string, string>;
    ports?: number[];
  };
};

export type LoadedMachine = MachineResources & {
  name: string;
  apiKey: string;
  image: string;
  options?: unknown;
  migrations: MigrationInstance<any>[];
  workspace?: DevMachineDefinition<any>["workspace"];
};

export type PlanMigration = {
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
  migrations: PlanMigration[];
};

export type WorkspaceRecord = {
  name: string;
  vmId: string;
  machine: string;
  snapshotId: string;
  createdAt: string;
};

export type DevMachineEvent =
  | { type: "definition.loaded"; machine: string }
  | { type: "plan.created"; machine: string; cachedPrefixLength: number; migrationCount: number }
  | { type: "vm.created"; vmId: string; fromSnapshotId?: string }
  | { type: "migration.skipped"; migration: string; snapshotId: string }
  | { type: "migration.started"; migration: string }
  | { type: "step.started"; migration?: string; step: string; command?: string }
  | { type: "step.output"; migration?: string; step: string; stream: "stdout" | "stderr"; data: string }
  | { type: "step.completed"; migration?: string; step: string; exitCode: number }
  | { type: "interaction.awaiting_user"; migration: string; label: string; command?: string; instructions?: string }
  | { type: "interaction.completed"; migration: string; label: string }
  | { type: "snapshot.created"; migration: string; snapshotId: string }
  | { type: "workspace.ready"; workspaceId: string; vmId: string; snapshotId: string };

export type EventHandler = (event: DevMachineEvent) => void;

