import { Freestyle, VmBaseImage } from "freestyle";
import type { CommandOptions, ExecOptions, ExecResult, JsonValue, WorkspaceRecord } from "@freestyle-sh/fdev";
import type {
  BaseDevMachineProvider,
  ProviderRuntimeContext,
  SnapshotHandle,
  SshConnection,
  SshOptions,
  VmHandle,
  WorkflowProviderController,
} from "@freestyle-sh/fdev-engine";
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

export type FreestyleWorkspaceContext = {
  ssh: SshConnection;
  host: string;
  username: string;
  vscodeAuthority: string;
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

export type FreestyleRuntime = {
  vms: {
    create(): Promise<FreestyleVmRuntime>;
    fromSnapshot(ref: FreestyleVmSnapshotRef): Promise<FreestyleVmRuntime>;
    fromWorkspace(workspace: Pick<WorkspaceRecord, "resourceId">): FreestyleVmRuntime;
  };
  openWorkspace(target: FreestyleVmRuntime | FreestyleVmSnapshotRef, options?: { cwd?: string }): Promise<void>;
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
  apiKey: string;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
  vm: FreestyleVmConfig;
}): BaseDevMachineProvider<FreestyleWorkspaceContext> {
  return new FreestyleProvider(input.apiKey, input.identityId, input.token, input.vm);
}

export function createFreestyleWorkflowProvider(input: {
  apiKey: string;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
  vm: FreestyleVmConfig;
}): WorkflowProviderController<FreestyleRuntime, FreestyleWorkspaceContext> {
  return createFreestyleWorkflowController(createFreestyleProvider(input));
}

export function createFreestyleWorkflowController(
  provider: BaseDevMachineProvider<FreestyleWorkspaceContext>,
): WorkflowProviderController<FreestyleRuntime, FreestyleWorkspaceContext> {
  return {
    providerId: FREESTYLE_PROVIDER_ID,
    runtime(context) {
      return createFreestyleRuntime(provider, context);
    },
    validateArtifact(ref) {
      return isFreestyleVmSnapshotRef(ref);
    },
    workspace: {
      canUse(ref) {
        return isFreestyleVmSnapshotRef(ref);
      },
      async createWorkspace(ref, input) {
        if (!isFreestyleVmSnapshotRef(ref)) {
          throw new Error(`Freestyle cannot create a workspace from this artifact`);
        }
        const vm = await provider.createVmFromSnapshot({ snapshotId: ref.snapshotId });
        return {
          providerId: FREESTYLE_PROVIDER_ID,
          resourceId: vm.vmId,
          snapshotId: ref.snapshotId,
          sourceRef: ref,
          metadata: { name: input.name },
        };
      },
      async deleteWorkspace(workspace) {
        await provider.deleteVm({ vmId: workspace.resourceId });
      },
      async snapshotWorkspace(workspace) {
        const snapshot = await provider.snapshot({ vmId: workspace.resourceId });
        return {
          providerId: FREESTYLE_PROVIDER_ID,
          resourceId: workspace.resourceId,
          snapshotId: snapshot.snapshotId,
          sourceRef: snapshotRef(snapshot),
        };
      },
      async ssh(workspaceOrResourceId, options) {
        return await provider.ssh({ vmId: workspaceOrResourceId }, options);
      },
      async workspaceContext(workspace) {
        const context = await provider.workspaceContext?.({ vmId: workspace.resourceId }, { workspace });
        if (!context) throw new Error(`Freestyle provider does not expose workspace context`);
        return context;
      },
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

function createFreestyleRuntime(
  provider: BaseDevMachineProvider<FreestyleWorkspaceContext>,
  context: ProviderRuntimeContext,
): FreestyleRuntime {
  const fromHandle = (vm: VmHandle): FreestyleVmRuntime => createVmRuntime(provider, vm, context);

  return {
    vms: {
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
      fromWorkspace: (workspace) => fromHandle({ vmId: workspace.resourceId }),
    },
    openWorkspace: async (target, options) => {
      const vm = isFreestyleVmSnapshotRef(target)
        ? await createFreestyleRuntime(provider, context).vms.fromSnapshot(target)
        : target;
      const workspaceContext = await provider.workspaceContext?.({ vmId: vm.vmId }, {
        workspace: {
          id: vm.vmId,
          name: vm.vmId,
          providerId: provider.providerId,
          workflow: context.workflow,
          resourceId: vm.vmId,
          sourceRef: null,
          context: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      });
      if (!workspaceContext?.vscodeAuthority) {
        throw new Error(`Freestyle workspace context did not include a VS Code authority`);
      }
      await context.local.open(
        `vscode://vscode-remote/ssh-remote+${encodeURIComponent(workspaceContext.vscodeAuthority)}${options?.cwd ?? ""}?windowId=_blank`,
      );
    },
  };
}

function createVmRuntime(
  provider: BaseDevMachineProvider<FreestyleWorkspaceContext>,
  vm: VmHandle,
  context: ProviderRuntimeContext,
): FreestyleVmRuntime {
  const runCommand = async (command: string, options?: CommandOptions) => {
    const commandName = options?.name ?? command;
    const { name: _name, ...execOptions } = options ?? {};
    context.emit({ type: "command.started", nodePath: context.nodePath, commandName, command });
    const result = await provider.exec(vm, command, execOptions);
    if (result.stdout) {
      context.emit({
        type: "command.output",
        nodePath: context.nodePath,
        commandName,
        stream: "stdout",
        data: result.stdout,
      });
    }
    if (result.stderr) {
      context.emit({
        type: "command.output",
        nodePath: context.nodePath,
        commandName,
        stream: "stderr",
        data: result.stderr,
      });
    }
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
