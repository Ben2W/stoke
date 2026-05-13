import { Freestyle, VmBaseImage } from "freestyle";
import type { CommandOptions, ExecOptions, ExecOutputChunk, ExecResult } from "@rigkit/sdk";
import type {
  BaseDevMachineProvider,
  ProviderRuntimeContext,
  SnapshotHandle,
  SshConnection,
  SshOptions,
  VmHandle,
  WorkflowProviderController,
} from "@rigkit/engine";
import type { CmuxOpenSshInput } from "@rigkit/provider-cmux";
import type { FreestyleIdentityId, FreestyleToken } from "./auth.ts";
import { createFreestyleTerminalSession } from "./terminal-session.ts";

type FreestyleVm = Awaited<ReturnType<Freestyle["vms"]["create"]>>["vm"];

export const FREESTYLE_PROVIDER_ID = "freestyle";
export const FREESTYLE_TERMINAL_PROVIDER_ID = "freestyle-terminal";

export type FreestyleVmConfig = {
  image: string;
  cpu?: number;
  memory?: string | number;
  disk?: string | number;
  idleTimeoutSeconds?: number | null;
};

export type FreestyleVmSnapshotRef = {
  provider: typeof FREESTYLE_PROVIDER_ID;
  kind: "vmSnapshot";
  snapshotId: string;
  sourceVmId?: string;
};

export type FreestyleVmRuntime = {
  readonly vmId: string;
  exec(command: string, options?: CommandOptions): Promise<ExecResult>;
  probe(command: string, options?: CommandOptions): Promise<ExecResult>;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  snapshotRef(): Promise<FreestyleVmSnapshotRef>;
  ssh(options?: SshOptions): Promise<SshConnection>;
};

export type FreestyleCmuxSshOptions = Exclude<CmuxOpenSshInput, string>;

export type FreestyleCmuxSshOptionsInput = Omit<
  FreestyleCmuxSshOptions,
  "kind" | "destination" | "host" | "username"
> & SshOptions;

export type FreestyleVscodeUrlOptions = SshOptions & {
  cwd?: string;
};

export type FreestyleRuntime = {
  readonly client: Freestyle;
  vms: {
    create(): Promise<FreestyleVmRuntime>;
    fromSnapshot(ref: FreestyleVmSnapshotRef): Promise<FreestyleVmRuntime>;
    fromId(vmId: string): FreestyleVmRuntime;
    delete(vmId: string): Promise<void>;
  };
  cmux: {
    createSshOptions(
      target: FreestyleVmRuntime | FreestyleVmSnapshotRef,
      options?: FreestyleCmuxSshOptionsInput,
    ): Promise<FreestyleCmuxSshOptions>;
  };
  vscode: {
    createUrl(
      target: FreestyleVmRuntime | FreestyleVmSnapshotRef,
      options?: FreestyleVscodeUrlOptions,
    ): Promise<string>;
  };
};

export type FreestyleTerminalRuntime = {
  open(
    title: string,
    options: {
      target: FreestyleVmRuntime;
      command?: string;
      instructions?: string;
    },
  ): Promise<{ finished: true }>;
};

export function createFreestyleProvider(input: {
  client: Freestyle;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
  vm: FreestyleVmConfig;
}): FreestyleDevMachineProvider {
  return new FreestyleProvider(input.client, input.identityId, input.token, input.vm);
}

export function createFreestyleWorkflowProvider(input: {
  client: Freestyle;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
  vm: FreestyleVmConfig;
}): WorkflowProviderController<FreestyleRuntime> {
  return createFreestyleWorkflowController(createFreestyleProvider(input));
}

export type FreestyleDevMachineProvider = BaseDevMachineProvider & {
  readonly client: Freestyle;
};

export function createFreestyleWorkflowController(
  provider: FreestyleDevMachineProvider,
): WorkflowProviderController<FreestyleRuntime> {
  return {
    providerId: FREESTYLE_PROVIDER_ID,
    runtime(context) {
      return createFreestyleRuntime(provider, context);
    },
    validateArtifact(ref) {
      return isFreestyleVmSnapshotRef(ref);
    },
  };
}

export function createFreestyleTerminalController(): WorkflowProviderController<FreestyleTerminalRuntime> {
  return {
    providerId: FREESTYLE_TERMINAL_PROVIDER_ID,
    runtime(context) {
      return {
        open: async (title, options) => {
          const terminal = await options.target.ssh();
          const command = buildInteractiveSshCommand(terminal, options.command);
          const session = createFreestyleTerminalSession({
            title,
            command,
            remoteCommand: options.command,
            instructions: options.instructions,
            nodePath: context.nodePath,
          });
          return await context.interaction.present(session);
        },
      };
    },
  };
}

class FreestyleProvider implements BaseDevMachineProvider {
  readonly providerId = FREESTYLE_PROVIDER_ID;
  readonly client: Freestyle;
  private readonly identityId: FreestyleIdentityId;
  private readonly token: FreestyleToken;
  private readonly vmConfig: FreestyleVmConfig;

  constructor(client: Freestyle, identityId: FreestyleIdentityId, token: FreestyleToken, vmConfig: FreestyleVmConfig) {
    this.client = client;
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

    if (stdout) await options?.onOutput?.({ stream: "stdout", data: stdout });
    if (stderr) await options?.onOutput?.({ stream: "stderr", data: stderr });

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
    const result = await this.exec(vm, `mkdir -p $(dirname ${shellQuote(path)}) && printf '%s' "$RIGKIT_FILE_CONTENT" > ${shellQuote(path)}`, {
      env: { RIGKIT_FILE_CONTENT: content },
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

  async workspaceContext(vm: VmHandle): Promise<{
    ssh: SshConnection;
    host: string;
    username: string;
    vscodeAuthority: string;
  }> {
    const ssh = await this.ssh(vm);
    return {
      ssh,
      host: ssh.host,
      username: ssh.username,
      vscodeAuthority: vscodeAuthorityForSsh(ssh),
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

function createFreestyleRuntime(
  provider: FreestyleDevMachineProvider,
  context: ProviderRuntimeContext,
): FreestyleRuntime {
  const fromHandle = (vm: VmHandle): FreestyleVmRuntime => createVmRuntime(provider, vm, context);

  const vms: FreestyleRuntime["vms"] = {
    create: async () => {
      const vm = await provider.createVm();
      context.emit({ type: "vm.created", providerId: provider.providerId, vmId: vm.vmId });
      return fromHandle(vm);
    },
    fromSnapshot: async (ref) => {
      const vm = await provider.createVmFromSnapshot({ snapshotId: ref.snapshotId });
      context.emit({
        type: "vm.created",
        providerId: provider.providerId,
        vmId: vm.vmId,
        fromSnapshotId: ref.snapshotId,
      });
      return fromHandle(vm);
    },
    fromId: (vmId) => fromHandle({ vmId }),
    delete: async (vmId) => {
      await provider.deleteVm({ vmId });
    },
  };

  const resolveVm = async (
    target: FreestyleVmRuntime | FreestyleVmSnapshotRef,
  ): Promise<FreestyleVmRuntime> => isFreestyleVmSnapshotRef(target) ? await vms.fromSnapshot(target) : target;

  const vscode: FreestyleRuntime["vscode"] = {
    createUrl: async (target, options) => {
      const vm = await resolveVm(target);
      const { cwd, user } = options ?? {};
      const ssh = await vm.ssh(user !== undefined ? { user } : undefined);
      return freestyleVscodeUrl(ssh, { cwd });
    },
  };

  return {
    client: provider.client,
    vms,
    cmux: {
      createSshOptions: async (target, options) => {
        const vm = await resolveVm(target);
        const { user, ...sshOptions } = options ?? {};
        const ssh = await vm.ssh(user !== undefined ? { user } : undefined);
        return freestyleCmuxSshOptions(ssh, sshOptions);
      },
    },
    vscode,
  };
}

const freestyleCmuxTokenSshOptions = [
  "StrictHostKeyChecking=no",
  "UserKnownHostsFile=/dev/null",
  "LogLevel=ERROR",
  "IdentitiesOnly=yes",
  "IdentityFile=/dev/null",
  "ControlMaster=no",
] as const;

function freestyleCmuxSshOptions(
  connection: SshConnection,
  options: Omit<FreestyleCmuxSshOptionsInput, keyof SshOptions> | undefined,
): FreestyleCmuxSshOptions {
  const { sshOptions, port, ...rest } = options ?? {};
  const mergedSshOptions = [
    ...(connection.auth.type === "token" ? freestyleCmuxTokenSshOptions : []),
    ...(sshOptions ?? []),
  ];
  return {
    kind: "ssh",
    destination: freestyleCmuxDestination(connection),
    ...(port !== undefined || connection.port !== undefined ? { port: port ?? connection.port } : {}),
    ...rest,
    ...(mergedSshOptions.length ? { sshOptions: mergedSshOptions } : {}),
  };
}

function freestyleCmuxDestination(connection: SshConnection): string {
  if (connection.auth.type === "token") return `${connection.username},${connection.auth.token}@${connection.host}`;
  return `${connection.username}@${connection.host}`;
}

function vscodeAuthorityForSsh(connection: SshConnection): string {
  if (connection.auth.type === "token") return `${connection.username}:${connection.auth.token}@${connection.host}`;
  return `${connection.username}@${connection.host}`;
}

function freestyleVscodeUrl(connection: SshConnection, options: { cwd?: string } = {}): string {
  return `vscode://vscode-remote/ssh-remote+${encodeURIComponent(vscodeAuthorityForSsh(connection))}${options.cwd ?? ""}?windowId=_blank`;
}

function createVmRuntime(
  provider: BaseDevMachineProvider,
  vm: VmHandle,
  context: ProviderRuntimeContext,
): FreestyleVmRuntime {
  const runCommand = async (command: string, options?: CommandOptions) => {
    const commandName = options?.name ?? command;
    const { name: _name, ...execOptions } = options ?? {};
    const callerOnOutput = execOptions.onOutput;
    const streamed = new Set<ExecOutputChunk["stream"]>();
    const onOutput = async (chunk: ExecOutputChunk) => {
      if (!chunk.data) return;
      streamed.add(chunk.stream);
      context.emit({
        type: "command.output",
        nodePath: context.nodePath,
        commandName,
        stream: chunk.stream,
        data: chunk.data,
      });
      await callerOnOutput?.(chunk);
    };
    context.emit({ type: "command.started", nodePath: context.nodePath, commandName, command });
    const result = await provider.exec(vm, command, {
      ...execOptions,
      onOutput,
    });
    if (result.stdout && !streamed.has("stdout")) await onOutput({ stream: "stdout", data: result.stdout });
    if (result.stderr && !streamed.has("stderr")) await onOutput({ stream: "stderr", data: result.stderr });
    context.emit({ type: "command.completed", nodePath: context.nodePath, commandName, exitCode: result.exitCode });
    return { commandName, result };
  };

  return {
    vmId: vm.vmId,
    exec: async (command, options) => {
      const { commandName, result } = await runCommand(command, options);
      if (!result.ok) {
        throw new Error(commandFailureMessage(commandName, result));
      }
      return result;
    },
    probe: async (command, options) => {
      const { result } = await runCommand(command, options);
      return result;
    },
    exists: async (path) => {
      const result = await provider.exec(vm, `test -e ${shellPath(path)}`);
      return result.ok;
    },
    readFile: (path) => provider.readFile(vm, path),
    writeFile: (path, content) => provider.writeFile(vm, path, content),
    snapshotRef: async () => {
      const snapshot = await provider.snapshot(vm);
      return snapshotRef(snapshot);
    },
    ssh: (options) => provider.ssh(vm, options),
  };
}

function snapshotRef(snapshot: SnapshotHandle): FreestyleVmSnapshotRef {
  return {
    provider: FREESTYLE_PROVIDER_ID,
    kind: "vmSnapshot",
    snapshotId: snapshot.snapshotId,
    sourceVmId: snapshot.sourceVmId,
  };
}

export function isFreestyleVmSnapshotRef(value: unknown): value is FreestyleVmSnapshotRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as FreestyleVmSnapshotRef).provider === FREESTYLE_PROVIDER_ID &&
      (value as FreestyleVmSnapshotRef).kind === "vmSnapshot" &&
      typeof (value as FreestyleVmSnapshotRef).snapshotId === "string",
  );
}

function shellPath(path: string): string {
  if (path.startsWith("~/")) return `~/${shellQuote(path.slice(2))}`;
  return shellQuote(path);
}

function buildInteractiveSshCommand(connection: SshConnection, remoteCommand: string | undefined): string {
  if (connection.auth.type === "privateKey") {
    return connection.command;
  }

  const destination = `${connection.username}:${connection.auth.token}@${connection.host}`;
  const args = ["ssh"];
  if (remoteCommand) args.push("-tt", "-q");
  if (connection.port !== undefined) args.push("-p", String(connection.port));
  args.push(destination);
  return args.map((arg) => arg === "ssh" || arg.startsWith("-") ? arg : shellQuote(arg)).join(" ");
}

function commandFailureMessage(name: string, result: { exitCode: number; stdout: string; stderr: string }): string {
  const output = [
    result.stdout ? `stdout:\n${result.stdout.trimEnd()}` : "",
    result.stderr ? `stderr:\n${result.stderr.trimEnd()}` : "",
  ].filter(Boolean).join("\n");
  return `Command "${name}" failed with exit code ${result.exitCode}${output ? `\n${output}` : ""}`;
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
