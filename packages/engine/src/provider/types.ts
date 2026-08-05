import type {
  EventHandler,
  ExecOptions,
  ExecResult,
  HostCapabilityRequirement,
  JsonObject,
  JsonValue,
  LoadedProviderDefinition,
  LocalWorkspaceRuntime,
  MaybePromise,
  WorkflowProviderCheckResult,
} from "../types.ts";

export type VmHandle = {
  vmId: string;
};

export type SnapshotHandle = {
  snapshotId: string;
  sourceVmId: string;
};

export type SshOptions = {
  user?: string;
};

export type SshConnection = {
  kind: "ssh";
  host: string;
  port?: number;
  username: string;
  auth: { type: "token"; token: string } | { type: "privateKey"; privateKey: string };
  command: string;
};

export interface BaseDevMachineProvider {
  readonly providerId: string;
  createVm(): Promise<VmHandle>;
  createVmFromSnapshot(input: { snapshotId: string }): Promise<VmHandle>;
  exec(vm: VmHandle, command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(vm: VmHandle, path: string): Promise<string>;
  writeFile(vm: VmHandle, path: string, content: string): Promise<void>;
  snapshot(vm: VmHandle): Promise<SnapshotHandle>;
  ssh(vm: VmHandle, options?: SshOptions): Promise<SshConnection>;
  deleteVm(vm: VmHandle): Promise<void>;
}

export type InteractionPresentationRequest = {
  id: string;
  nodePath: string;
  title: string;
  url: string;
  instructions?: string;
};

export type InteractionPresenter = (request: InteractionPresentationRequest) => Promise<void>;

export type ProviderInteractionSession<Result = void> = {
  id?: string;
  title: string;
  url: string;
  instructions?: string;
  completed: Promise<Result>;
  stop(): MaybePromise<void>;
};

export type ProviderRuntimeContext = {
  workflow: string;
  nodePath: string;
  emit: EventHandler;
  interaction: {
    present<Result>(session: ProviderInteractionSession<Result>): Promise<Result>;
  };
  local: LocalWorkspaceRuntime;
  metadata(metadata: JsonObject): void;
};

export type ProviderCheckContext = {
  mode: "plan" | "require";
  workflow: string;
  local: LocalWorkspaceRuntime;
};

export interface WorkflowProviderController<Runtime = unknown> {
  readonly providerId: string;
  runtime(context: ProviderRuntimeContext): MaybePromise<Runtime>;
  checks?(context: ProviderCheckContext): MaybePromise<WorkflowProviderCheckResult | WorkflowProviderCheckResult[] | undefined>;
  validateArtifact?(ref: JsonValue): MaybePromise<boolean>;
}

export type ProviderFactoryInput = {
  provider: LoadedProviderDefinition;
  storage: ProviderStorage;
  hostStorage: ProviderStorage;
  local: LocalWorkspaceRuntime;
};

export type ProviderFactory = (
  input: ProviderFactoryInput,
) => WorkflowProviderController | Promise<WorkflowProviderController>;

export type ProviderStorageRecord<Value extends JsonValue = JsonValue> = {
  providerId: string;
  key: string;
  value: Value;
  createdAt: string;
  updatedAt: string;
};

export interface ProviderStorage {
  get<Value extends JsonValue = JsonValue>(key: string): ProviderStorageRecord<Value> | undefined;
  set<Value extends JsonValue = JsonValue>(key: string, value: Value): ProviderStorageRecord<Value>;
  delete(key: string): void;
  entries(prefix?: string): ProviderStorageRecord[];
}

export type BaseProviderPlugin = {
  providerId: string;
  /** Host-side capabilities required by code using this provider. */
  capabilities?: readonly HostCapabilityRequirement[];
  createProvider(input: ProviderFactoryInput): WorkflowProviderController | Promise<WorkflowProviderController>;
};

export type DevMachineProvider = BaseDevMachineProvider;
