import { Freestyle } from "freestyle";
import type {
  SshConnection,
  SshOptions,
  WorkflowProviderController,
} from "@rigkit/engine";
import type { CmuxOpenSshInput } from "@rigkit/provider-cmux";
import type { FreestyleIdentityId, FreestyleToken } from "./auth.ts";
import { createFreestyleTerminalSession } from "./terminal-session.ts";

export const FREESTYLE_PROVIDER_ID = "freestyle";
export const FREESTYLE_TERMINAL_PROVIDER_ID = "freestyle-terminal";

export type FreestyleSdkVm = ReturnType<Freestyle["vms"]["ref"]>;

export type FreestyleSshInput = SshOptions & {
  vmId: string;
};

export type FreestyleCmuxSshOptions = Exclude<CmuxOpenSshInput, string>;

export type FreestyleCmuxSshOptionsInput = Omit<
  FreestyleCmuxSshOptions,
  "kind" | "destination" | "host" | "username"
> & FreestyleSshInput;

export type FreestyleVscodeUrlOptions = FreestyleSshInput & {
  cwd?: string;
};

export type FreestyleRuntime = {
  readonly client: Freestyle;
  createSSHOptions(input: FreestyleSshInput): Promise<SshConnection>;
  cmux: {
    createSshOptions(input: FreestyleCmuxSshOptionsInput): Promise<FreestyleCmuxSshOptions>;
  };
  vscode: {
    createUrl(input: FreestyleVscodeUrlOptions): Promise<string>;
  };
};

export type FreestyleTerminalRuntime = {
  open(
    title: string,
    options: {
      ssh: SshConnection;
      command?: string;
      keepOpenAfterCommand?: boolean;
      instructions?: string;
    },
  ): Promise<{ finished: true }>;
};

export function createFreestyleWorkflowProvider(input: {
  client: Freestyle;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
}): WorkflowProviderController<FreestyleRuntime> {
  return createFreestyleWorkflowController(input);
}

export function createFreestyleWorkflowController(input: {
  client: Freestyle;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
}): WorkflowProviderController<FreestyleRuntime> {
  return {
    providerId: FREESTYLE_PROVIDER_ID,
    runtime() {
      return createFreestyleRuntime(input);
    },
  };
}

export function createFreestyleTerminalController(): WorkflowProviderController<FreestyleTerminalRuntime> {
  return {
    providerId: FREESTYLE_TERMINAL_PROVIDER_ID,
    runtime(context) {
      return {
        open: async (title, options) => {
          const command = buildInteractiveSshCommand(options.ssh, options.command, {
            keepOpenAfterCommand: options.keepOpenAfterCommand,
          });
          const session = createFreestyleTerminalSession({
            title,
            command,
            displayCommand: options.command,
            canFinishWhileRunning: options.keepOpenAfterCommand,
            instructions: options.instructions,
            nodePath: context.nodePath,
          });
          return await context.interaction.present(session);
        },
      };
    },
  };
}

function createFreestyleRuntime(input: {
  client: Freestyle;
  identityId: FreestyleIdentityId;
  token: FreestyleToken;
}): FreestyleRuntime {
  const ensureSSHAccess = async (vmId: string) => {
    const identity = input.client.identities.ref({ identityId: input.identityId });
    try {
      await identity.permissions.vms.grant({ vmId });
    } catch (error) {
      if (!isPermissionAlreadyExistsError(error)) {
        throw error;
      }
      await identity.permissions.vms.update({ vmId });
    }
  };

  const runtime: FreestyleRuntime = {
    client: input.client,
    createSSHOptions: async ({ vmId, user }) => {
      await ensureSSHAccess(vmId);
      return freestyleSshConnection(vmId, input.token, user);
    },
    cmux: {
      createSshOptions: async (options) => {
        const { vmId, user, ...sshOptions } = options;
        const ssh = await runtime.createSSHOptions({ vmId, user });
        return freestyleCmuxSshOptions(ssh, sshOptions);
      },
    },
    vscode: {
      createUrl: async ({ vmId, user, cwd }) => {
        const ssh = await runtime.createSSHOptions({ vmId, user });
        return freestyleVscodeUrl(ssh, { cwd });
      },
    },
  };

  return runtime;
}

const defaultFreestyleVmUser = "root";

function freestyleSshConnection(vmId: string, token: FreestyleToken, user: string | undefined): SshConnection {
  const userPart = `+${user ?? defaultFreestyleVmUser}`;
  const username = `${vmId}${userPart}`;
  return {
    kind: "ssh",
    host: "vm-ssh.freestyle.sh",
    username,
    auth: { type: "token", token },
    command: `ssh ${username}:${token}@vm-ssh.freestyle.sh`,
  };
}

function isPermissionAlreadyExistsError(error: unknown): boolean {
  return errorStrings(error).some((value) =>
    normalizeErrorCode(value).includes("PERMISSIONALREADYEXISTS"),
  );
}

function errorStrings(error: unknown): string[] {
  if (typeof error === "string") return [error];
  if (!error || typeof error !== "object") return [];

  const record = error as Record<string, unknown>;
  const values: string[] = [];
  for (const key of ["error", "code", "name", "message", "reason"]) {
    const value = record[key];
    if (typeof value === "string") values.push(value);
    else values.push(...errorStrings(value));
  }
  values.push(...errorStrings(record.cause));
  return values;
}

function normalizeErrorCode(value: string): string {
  return value.replaceAll(/[^a-zA-Z]/g, "").toUpperCase();
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
  options: Omit<FreestyleCmuxSshOptionsInput, keyof FreestyleSshInput> | undefined,
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

export function buildInteractiveSshCommand(
  connection: SshConnection,
  remoteCommand: string | undefined,
  options: { keepOpenAfterCommand?: boolean } = {},
): string {
  if (connection.auth.type === "privateKey") {
    return connection.command;
  }

  const command = remoteCommand && options.keepOpenAfterCommand
    ? keepOpenAfterCommand(remoteCommand)
    : remoteCommand;
  const destination = `${connection.username}:${connection.auth.token}@${connection.host}`;
  const args = ["ssh"];
  if (command) args.push("-tt", "-q");
  if (connection.port !== undefined) args.push("-p", String(connection.port));
  args.push(destination);
  if (command) args.push(withBrowserOpenFallback(command));
  return args.map((arg) => arg === "ssh" || arg.startsWith("-") ? arg : shellQuote(arg)).join(" ");
}

function withBrowserOpenFallback(command: string): string {
  return [
    'export BROWSER="${BROWSER:-true}"',
    'export GH_BROWSER="${GH_BROWSER:-$BROWSER}"',
    command,
  ].join("\n");
}

function keepOpenAfterCommand(command: string): string {
  return [
    command,
    "status=$?",
    'if [ "$status" -ne 0 ]; then exit "$status"; fi',
    `printf '\\nCommand completed. Type exit to continue.\\n'`,
    'exec "${SHELL:-/bin/bash}" -l',
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
