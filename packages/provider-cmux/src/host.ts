import {
  createCmuxClient,
  formatShellCommand,
  type CmuxBrowserOpenOptions,
  type CmuxClient,
  type CmuxClientOptions,
  type CmuxNewPaneOptions,
  type CmuxNewWorkspaceOptions,
  type CmuxPane,
  type CmuxPortsKickOptions,
  type CmuxSendOptions,
  type CmuxSshOptions,
  type CmuxWaitForRemoteOptions,
  type CmuxWorkspace,
} from "./index.ts";
import {
  defineHostCapability,
  type HostCapabilityContext,
  type HostCapabilityHandler,
} from "@rigkit/sdk/host";
import {
  CMUX_OPEN_CAPABILITY,
  type CmuxOpenInput,
  type CmuxOpenResult,
  type CmuxOpenSshInput,
  type CmuxRemoteReadyOptions,
} from "./capabilities.ts";

export type CmuxHostCapabilityHandler = HostCapabilityHandler;

export type CmuxOpenClient = Pick<
  CmuxClient,
  | "newWorkspace"
  | "ssh"
  | "newPane"
  | "send"
  | "portsKick"
  | "browserOpen"
  | "selectWorkspace"
  | "waitForRemoteReady"
>;

export type CmuxOpenHostOptions = {
  client?: CmuxOpenClient;
  clientOptions?: CmuxClientOptions;
  logger?: (message: string) => void;
};

export function createCmuxOpenHostCapability(
  options: CmuxOpenHostOptions = {},
): CmuxHostCapabilityHandler {
  return defineHostCapability(CMUX_OPEN_CAPABILITY.id, {
    schemaHash: CMUX_OPEN_CAPABILITY.schemaHash,
    handle: async (params, context) =>
      await openCmux(params, {
        ...options,
        logger: options.logger ?? hostCapabilityLogger(context) ?? options.clientOptions?.logger,
      }),
  });
}

export const cmuxHostCapabilities = [createCmuxOpenHostCapability()] as const;

export async function openCmux(
  params: unknown,
  options: CmuxOpenHostOptions = {},
): Promise<CmuxOpenResult> {
  const input = parseCmuxOpenInput(params);
  const logger = cmuxOpenLogger(options);
  const cmux = options.client ?? createCmuxClient({
    ...options.clientOptions,
    ...(options.logger ? { logger: options.logger } : {}),
    printCommands: options.clientOptions?.printCommands ?? false,
  });
  const command = commandForInput(input);
  let workspace: CmuxWorkspace;
  let terminalPane: CmuxPane | undefined;

  logger?.(`cmux: opening ${input.name}`);
  if (input.ssh) {
    logger?.("cmux: connecting remote workspace");
    workspace = await cmux.ssh({
      ...cmuxSshOptionsForInput(input.ssh),
      name: input.name,
      noFocus: input.focus === false,
    });
  } else {
    logger?.("cmux: creating workspace");
    const workspaceOptions: CmuxNewWorkspaceOptions = {
      name: input.name,
      cwd: input.cwd,
      command: input.command,
      focus: input.focus,
    };
    workspace = await cmux.newWorkspace(workspaceOptions);
  }

  const workspaceId = workspace.id ?? workspace.handle;

  if (input.ssh && command) {
    logger?.(input.cwd ? `cmux: starting command in ${input.cwd}` : "cmux: starting command");
    const paneOptions: CmuxNewPaneOptions = {
      workspace: workspaceId,
      type: "terminal",
      direction: "down",
      focus: true,
    };
    terminalPane = await cmux.newPane(paneOptions);
    const sendOptions: CmuxSendOptions = {
      workspace: workspaceId,
      surface: terminalPane.surface,
      text: command,
    };
    await cmux.send(sendOptions);
  }

  const waitOptions = remoteReadyOptionsForInput(input);
  if (input.ssh && waitOptions) {
    logger?.("cmux: waiting for remote ports");
    await cmux.waitForRemoteReady(workspaceId, waitOptions);
  }

  if (input.ssh && terminalPane?.surface) {
    logger?.("cmux: refreshing remote ports");
    const kickOptions: CmuxPortsKickOptions = {
      workspace: workspaceId,
      surface: terminalPane.surface,
      reason: "command",
    };
    await cmux.portsKick(kickOptions);
  }

  let browserPane: CmuxPane | undefined;
  if (input.url) {
    logger?.(`cmux: opening ${input.url}`);
    const browserOptions: CmuxBrowserOpenOptions = {
      workspace: workspaceId,
      url: input.url,
      focus: input.focus !== false,
    };
    browserPane = await cmux.browserOpen(browserOptions);
  }

  if (input.focus !== false) {
    logger?.("cmux: focusing workspace");
    await cmux.selectWorkspace(workspaceId);
  }

  logger?.(`cmux: ready ${input.name}`);
  return {
    sessionId: workspaceId,
    workspaceId,
    ...(workspace.ref ? { workspaceRef: workspace.ref } : {}),
    ...(terminalPane?.pane ? { terminalPaneId: terminalPane.pane } : {}),
    ...(terminalPane?.surface ? { terminalSurfaceId: terminalPane.surface } : {}),
    ...(browserPane?.pane ? { browserPaneId: browserPane.pane } : {}),
    ...(browserPane?.surface ? { browserSurfaceId: browserPane.surface } : {}),
  };
}

function cmuxOpenLogger(options: CmuxOpenHostOptions): ((message: string) => void) | undefined {
  return options.logger ?? options.clientOptions?.logger;
}

function hostCapabilityLogger(context: HostCapabilityContext | undefined): ((message: string) => void) | undefined {
  if (!context) return undefined;
  return (message) => context.log(message, { label: "cmux" });
}

export function parseCmuxOpenInput(value: unknown): CmuxOpenInput {
  if (!isRecord(value)) throw new Error(`cmux.open requires an object input`);
  const name = requiredString(value, "name");
  return {
    name,
    ...(value.ssh !== undefined ? { ssh: parseSshInput(value.ssh) } : {}),
    ...optionalStringField(value, "cwd"),
    ...optionalStringField(value, "command"),
    ...optionalStringField(value, "url"),
    ...optionalBooleanField(value, "focus"),
    ...(value.waitForRemoteReady !== undefined
      ? { waitForRemoteReady: parseRemoteReadyOptions(value.waitForRemoteReady) }
      : {}),
  };
}

function parseSshInput(value: unknown): CmuxOpenSshInput {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) throw new Error(`cmux.open ssh must be a string or object`);
  if (value.kind !== undefined && value.kind !== "ssh") {
    throw new Error(`cmux.open ssh.kind must be "ssh"`);
  }
  return {
    ...optionalStringField(value, "destination"),
    ...optionalStringField(value, "host"),
    ...optionalNumberField(value, "port"),
    ...optionalStringField(value, "username"),
    ...optionalStringField(value, "identity"),
    ...optionalStringArrayField(value, "sshOptions"),
    ...optionalStringArrayField(value, "remoteCommandArgs"),
    ...optionalStringField(value, "initialCommand"),
    ...optionalStringField(value, "terminalStartupCommand"),
    ...optionalBooleanField(value, "autoConnect"),
    ...optionalBooleanField(value, "skipDaemonBootstrap"),
  };
}

function parseRemoteReadyOptions(value: unknown): boolean | CmuxRemoteReadyOptions {
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) throw new Error(`cmux.open waitForRemoteReady must be a boolean or object`);
  return {
    ...optionalNumberField(value, "timeoutMs"),
    ...optionalNumberField(value, "intervalMs"),
    ...optionalBooleanField(value, "requireProxy"),
  };
}

function cmuxSshOptionsForInput(ssh: CmuxOpenSshInput): CmuxSshOptions {
  if (typeof ssh === "string") return { destination: ssh };

  const destination = ssh.destination ?? sshDestination(ssh);
  return {
    destination,
    ...(ssh.port !== undefined ? { port: ssh.port } : {}),
    ...(ssh.identity !== undefined ? { identity: ssh.identity } : {}),
    ...(ssh.sshOptions?.length ? { sshOptions: ssh.sshOptions } : {}),
    ...(ssh.remoteCommandArgs !== undefined ? { remoteCommandArgs: ssh.remoteCommandArgs } : {}),
    ...(ssh.initialCommand !== undefined ? { initialCommand: ssh.initialCommand } : {}),
    ...(ssh.terminalStartupCommand !== undefined ? { terminalStartupCommand: ssh.terminalStartupCommand } : {}),
    ...(ssh.autoConnect !== undefined ? { autoConnect: ssh.autoConnect } : {}),
    ...(ssh.skipDaemonBootstrap !== undefined ? { skipDaemonBootstrap: ssh.skipDaemonBootstrap } : {}),
  };
}

function sshDestination(ssh: Extract<CmuxOpenSshInput, object>): string {
  if (!ssh.host) throw new Error(`cmux.open ssh.host is required when ssh.destination is omitted`);
  if (!ssh.username) throw new Error(`cmux.open ssh.username is required when ssh.destination is omitted`);
  return `${ssh.username}@${ssh.host}`;
}

function commandForInput(input: CmuxOpenInput): string | undefined {
  if (!input.command) return undefined;
  const prefix = input.cwd ? `${formatShellCommand(["cd", input.cwd])} && ` : "";
  return `${prefix}${input.command}\n`;
}

function remoteReadyOptionsForInput(input: CmuxOpenInput): CmuxWaitForRemoteOptions | false {
  if (input.waitForRemoteReady === false) return false;
  if (input.waitForRemoteReady === true || input.waitForRemoteReady === undefined) {
    return input.url ? {} : false;
  }
  return input.waitForRemoteReady;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`cmux.open ${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
  expected?: string,
): Record<string, string> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`cmux.open ${key} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (expected !== undefined && normalized !== expected) {
    throw new Error(`cmux.open ${key} must be "${expected}"`);
  }
  return { [key]: normalized };
}

function optionalStringArrayField(record: Record<string, unknown>, key: string): Record<string, string[]> {
  const value = record[key];
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`cmux.open ${key} must be an array of strings`);
  }
  return { [key]: value };
}

function optionalNumberField(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`cmux.open ${key} must be a finite number`);
  }
  return { [key]: value };
}

function optionalBooleanField(record: Record<string, unknown>, key: string): Record<string, boolean> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw new Error(`cmux.open ${key} must be a boolean`);
  return { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
