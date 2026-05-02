import type { ExecOptions, ExecResult } from "@freestyle/fdev-sdk";

export type CreateVmInput = {
  image: string;
  cpu?: number;
  memory?: string | number;
  disk?: string | number;
  idleTimeoutSeconds?: number | null;
};

export type VmHandle = {
  vmId: string;
};

export type SnapshotHandle = {
  snapshotId: string;
  sourceVmId: string;
};

export type TerminalHandle = {
  command: string;
};

export interface DevMachineProvider {
  createVm(input: CreateVmInput): Promise<VmHandle>;
  createVmFromSnapshot(input: { snapshotId: string; idleTimeoutSeconds?: number | null }): Promise<VmHandle>;
  exec(vm: VmHandle, command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(vm: VmHandle, path: string): Promise<string>;
  writeFile(vm: VmHandle, path: string, content: string): Promise<void>;
  snapshot(vm: VmHandle): Promise<SnapshotHandle>;
  forkVm(vm: VmHandle): Promise<VmHandle>;
  openTerminal(vm: VmHandle, options?: { user?: string }): Promise<TerminalHandle>;
  deleteVm(vm: VmHandle): Promise<void>;
}
