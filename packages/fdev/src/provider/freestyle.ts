import { Freestyle, VmBaseImage } from "freestyle";
import type { ExecOptions, ExecResult } from "../types.ts";
import type { CreateVmInput, DevMachineProvider, SnapshotHandle, TerminalHandle, VmHandle } from "./types.ts";

type FreestyleVm = Awaited<ReturnType<Freestyle["vms"]["create"]>>["vm"];

export function createFreestyleProvider(input: { apiKey: string }): DevMachineProvider {
  return new FreestyleProvider(input.apiKey);
}

class FreestyleProvider implements DevMachineProvider {
  private readonly client: Freestyle;

  constructor(apiKey: string) {
    this.client = new Freestyle({ apiKey });
  }

  async createVm(input: CreateVmInput): Promise<VmHandle> {
    const { vmId } = await this.client.vms.create({
      baseImage: new VmBaseImage(toDockerFrom(input.image)),
      vcpuCount: input.cpu,
      memSizeGb: parseSizeGb(input.memory),
      rootfsSizeGb: parseSizeGb(input.disk),
      idleTimeoutSeconds: input.idleTimeoutSeconds ?? 3600,
    });

    return { vmId };
  }

  async createVmFromSnapshot(input: { snapshotId: string; idleTimeoutSeconds?: number | null }): Promise<VmHandle> {
    const { vmId } = await this.client.vms.create({
      snapshotId: input.snapshotId,
      idleTimeoutSeconds: input.idleTimeoutSeconds ?? 3600,
    });

    return { vmId };
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

  async forkVm(vm: VmHandle): Promise<VmHandle> {
    const result = await this.ref(vm).fork();
    const first = result.forks[0];
    if (!first) throw new Error(`Freestyle fork did not return a VM`);
    return { vmId: first.vmId };
  }

  async openTerminal(vm: VmHandle, options?: { user?: string }): Promise<TerminalHandle> {
    const { identity } = await this.client.identities.create();
    await identity.permissions.vms.grant({
      vmId: vm.vmId,
      allowedUsers: options?.user ? [options.user] : undefined,
    });
    const { token } = await identity.tokens.create();
    const userPart = options?.user ? `+${options.user}` : "";
    return {
      command: `ssh ${vm.vmId}${userPart}:${token}@vm-ssh.freestyle.sh`,
    };
  }

  async deleteVm(vm: VmHandle): Promise<void> {
    await this.client.vms.delete({ vmId: vm.vmId });
  }

  private ref(vm: VmHandle): FreestyleVm {
    return this.client.vms.ref({ vmId: vm.vmId });
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

function wrapCommand(command: string, options?: ExecOptions): string {
  const parts: string[] = ["set -o pipefail"];

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
