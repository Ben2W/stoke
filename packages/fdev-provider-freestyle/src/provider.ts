import { Freestyle, VmBaseImage } from "freestyle";
import type { ExecOptions, ExecResult } from "@freestyle-sh/fdev-sdk";
import type { BaseDevMachineProvider, SnapshotHandle, SshConnection, SshOptions, VmHandle } from "@freestyle-sh/fdev-engine";
import type { FreestyleIdentityId, FreestyleToken } from "./auth.ts";

type FreestyleVm = Awaited<ReturnType<Freestyle["vms"]["create"]>>["vm"];

export const FREESTYLE_PROVIDER_ID = "freestyle";

export type FreestyleVmConfig = {
  image: string;
  cpu?: number;
  memory?: string | number;
  disk?: string | number;
  idleTimeoutSeconds?: number | null;
};

export type FreestyleWorkspaceContext = {
  ssh: SshConnection;
  host: string;
  username: string;
  vscodeAuthority: string;
};

export function createFreestyleProvider(input: {
  apiKey: string;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
  vm: FreestyleVmConfig;
}): BaseDevMachineProvider<FreestyleWorkspaceContext> {
  return new FreestyleProvider(input.apiKey, input.identityId, input.token, input.vm);
}

class FreestyleProvider implements BaseDevMachineProvider<FreestyleWorkspaceContext> {
  readonly providerId = FREESTYLE_PROVIDER_ID;
  private readonly client: Freestyle;
  private readonly identityId: FreestyleIdentityId;
  private readonly token: FreestyleToken;
  private readonly vmConfig: FreestyleVmConfig;

  constructor(apiKey: string, identityId: FreestyleIdentityId, token: FreestyleToken, vmConfig: FreestyleVmConfig) {
    this.client = new Freestyle({ apiKey });
    this.identityId = identityId;
    this.token = token;
    this.vmConfig = vmConfig;
  }

  async createVm(): Promise<VmHandle> {
    const { vmId } = await this.client.vms.create({
      baseImage: new VmBaseImage(toDockerFrom(this.vmConfig.image)),
      vcpuCount: this.vmConfig.cpu,
      memSizeGb: parseSizeGb(this.vmConfig.memory),
      rootfsSizeGb: parseSizeGb(this.vmConfig.disk),
      idleTimeoutSeconds: this.vmConfig.idleTimeoutSeconds ?? 3600,
    });

    const vm = { vmId };
    await this.updateVmPermissions(vm);
    return vm;
  }

  async createVmFromSnapshot(input: { snapshotId: string }): Promise<VmHandle> {
    const { vmId } = await this.client.vms.create({
      snapshotId: input.snapshotId,
      idleTimeoutSeconds: this.vmConfig.idleTimeoutSeconds ?? 3600,
    });

    const vm = { vmId };
    await this.updateVmPermissions(vm);
    return vm;
  }

  async exec(vm: VmHandle, command: string, options?: ExecOptions): Promise<ExecResult> {
    const freestyleVm = this.ref(vm);
    const wrapped = wrapCommand(command, options);
    const result = await freestyleVm.exec({
      command: wrapped,
      timeoutMs: options?.timeoutMs,
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.statusCode ?? 0;

    return {
      stdout,
      stderr,
      exitCode,
      ok: exitCode === 0,
    };
  }

  async readFile(vm: VmHandle, path: string): Promise<string> {
    const result = await this.exec(vm, `cat ${shellQuote(path)}`);
    if (!result.ok) {
      throw new Error(`Failed to read ${path}: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  async writeFile(vm: VmHandle, path: string, content: string): Promise<void> {
    const result = await this.exec(vm, `mkdir -p $(dirname ${shellQuote(path)}) && printf '%s' "$FDEV_FILE_CONTENT" > ${shellQuote(path)}`, {
      env: { FDEV_FILE_CONTENT: content },
    });
    if (!result.ok) {
      throw new Error(`Failed to write ${path}: ${result.stderr || result.stdout}`);
    }
  }

  async snapshot(vm: VmHandle): Promise<SnapshotHandle> {
    const result = await this.ref(vm).snapshot();
    return {
      snapshotId: result.snapshotId,
      sourceVmId: result.sourceVmId,
    };
  }

  async ssh(vm: VmHandle, options?: SshOptions): Promise<SshConnection> {
    const userPart = options?.user ? `+${options.user}` : "";
    const username = `${vm.vmId}${userPart}`;
    return {
      kind: "ssh",
      host: "vm-ssh.freestyle.sh",
      username,
      auth: { type: "token", token: this.token },
      command: `ssh ${username}:${this.token}@vm-ssh.freestyle.sh`,
    };
  }

  async workspaceContext(vm: VmHandle): Promise<FreestyleWorkspaceContext> {
    const ssh = await this.ssh(vm);
    return {
      ssh,
      host: ssh.host,
      username: ssh.username,
      vscodeAuthority: `${ssh.username}:${this.token}@${ssh.host}`,
    };
  }

  async deleteVm(vm: VmHandle): Promise<void> {
    await this.client.vms.delete({ vmId: vm.vmId });
  }

  private ref(vm: VmHandle): FreestyleVm {
    return this.client.vms.ref({ vmId: vm.vmId });
  }

  private async updateVmPermissions(vm: VmHandle): Promise<void> {
    const identity = this.client.identities.ref({ identityId: this.identityId });
    try {
      await identity.permissions.vms.grant({ vmId: vm.vmId });
    } catch (error) {
      if (!isPermissionAlreadyExistsError(error)) {
        throw error;
      }
      await identity.permissions.vms.update({ vmId: vm.vmId });
    }
  }
}

function toDockerFrom(image: string): string {
  if (image.trim().startsWith("FROM ")) return image;
  if (image.includes(":")) return `FROM ${image}`;

  const match = /^([a-z0-9][a-z0-9-]*)-(\d+(?:\.\d+)*)$/i.exec(image);
  if (match) return `FROM ${match[1]}:${match[2]}`;

  return `FROM ${image}`;
}

function parseSizeGb(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith("gib")) return Number(trimmed.slice(0, -3));
  if (trimmed.endsWith("gb")) return Number(trimmed.slice(0, -2));
  return Number(trimmed);
}

export function wrapCommand(command: string, options?: ExecOptions): string {
  const parts: string[] = [
    "set -o pipefail",
    "export HOME=${HOME:-/root}",
  ];

  if (options?.cwd) {
    parts.push(`cd ${shellQuote(options.cwd)}`);
  }

  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== undefined) {
        parts.push(`export ${key}=${shellQuote(value)}`);
      }
    }
  }

  parts.push(command);
  return `bash -lc ${shellQuote(parts.join("\n"))}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isPermissionAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && error.name === "PermissionAlreadyExistsError";
}
