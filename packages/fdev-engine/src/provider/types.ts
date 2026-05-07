import type {
  EventHandler,
  ExecOptions,
  ExecResult,
  JsonObject,
  JsonValue,
  LoadedProviderDefinition,
  LocalWorkspaceRuntime,
  MaybePromise,
  ProviderWorkspaceContext,
  WorkspaceRecord,
} from "@freestyle-sh/fdev-sdk";
import type { FdevDatabase, FdevDatabaseSchema } from "../db/index.ts";

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

export interface BaseDevMachineProvider<
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> {
  readonly providerId: string;
  createVm(): Promise<VmHandle>;
  createVmFromSnapshot(input: { snapshotId: string }): Promise<VmHandle>;
  exec(vm: VmHandle, command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(vm: VmHandle, path: string): Promise<string>;
  writeFile(vm: VmHandle, path: string, content: string): Promise<void>;
  snapshot(vm: VmHandle): Promise<SnapshotHandle>;
  ssh(vm: VmHandle, options?: SshOptions): Promise<SshConnection>;
  workspaceContext?(vm: VmHandle, input: { workspace: WorkspaceRecord }): MaybePromise<WorkspaceContext>;
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

export type WorkflowWorkspaceCreateResult = {
  providerId?: string;
  resourceId: string;
  snapshotId?: string;
  sourceRef?: JsonValue;
  metadata?: JsonObject;
};

export interface WorkflowWorkspaceProvider<
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> {
  canUse(sourceRef: JsonValue): boolean;
  createWorkspace(sourceRef: JsonValue, input: { name: string }): Promise<WorkflowWorkspaceCreateResult>;
  deleteWorkspace(workspace: WorkspaceRecord): Promise<void>;
  snapshotWorkspace(workspace: WorkspaceRecord): Promise<WorkflowWorkspaceCreateResult>;
  ssh(workspaceOrResourceId: string, options?: SshOptions): Promise<SshConnection>;
  workspaceContext?(workspace: WorkspaceRecord): MaybePromise<WorkspaceContext>;
}

export interface WorkflowProviderController<
  Runtime = unknown,
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
> {
  readonly providerId: string;
  runtime(context: ProviderRuntimeContext): MaybePromise<Runtime>;
  validateArtifact?(ref: JsonValue): MaybePromise<boolean>;
  workspace?: WorkflowWorkspaceProvider<WorkspaceContext>;
}

export type ProviderFactoryInput = {
  provider: LoadedProviderDefinition;
  db: FdevDatabase<FdevDatabaseSchema>;
};

export type ProviderFactory = (
  input: ProviderFactoryInput,
) => WorkflowProviderController | Promise<WorkflowProviderController>;

export type BaseProviderPlugin = {
  providerId: string;
  schema?: FdevDatabaseSchema;
  createProvider(input: ProviderFactoryInput): WorkflowProviderController | Promise<WorkflowProviderController>;
};

export type DevMachineProvider = BaseDevMachineProvider;
