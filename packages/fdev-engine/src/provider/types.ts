import type { ExecOptions, ExecResult, LoadedProviderDefinition } from "@freestyle-sh/fdev-sdk";
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

export type ProviderFactoryInput = {
  provider: LoadedProviderDefinition;
  db: FdevDatabase<FdevDatabaseSchema>;
};

export type ProviderFactory = (input: ProviderFactoryInput) => BaseDevMachineProvider | Promise<BaseDevMachineProvider>;

export type BaseProviderPlugin = {
  providerId: string;
  schema?: FdevDatabaseSchema;
  createProvider(input: ProviderFactoryInput): BaseDevMachineProvider | Promise<BaseDevMachineProvider>;
};

export type DevMachineProvider = BaseDevMachineProvider;
