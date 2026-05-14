import {
  createCmuxClient,
  formatShellCommand,
  type CmuxClient,
  type CmuxClientOptions,
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
  type CmuxOpenPaneResult,
  type CmuxOpenResult,
  type CmuxOpenSshInput,
  type CmuxOpenTerminalDirection,
  type CmuxOpenTerminalInput,
  type CmuxRemoteReadyOptions,
} from "./capabilities.ts";

export type CmuxHostCapabilityHandler = HostCapabilityHandler;

export type CmuxOpenClient = Pick<
  CmuxClient,
  | "newWorkspace"
  | "ssh"
  | "newPane"
  | "newSurface"
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
  let workspace: CmuxWorkspace;
  const terminalPanes: CmuxPane[] = [];

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
      focus: input.focus,
    };
    workspace = await cmux.newWorkspace(workspaceOptions);
  }

  const workspaceId = workspace.id ?? workspace.handle;
  const useTabLayout = input.surfaceLayout === "tabs";

  for (const terminal of input.terminals ?? []) {
    const cwd = terminal.cwd ?? input.cwd;
    logger?.(cwd ? `cmux: starting terminal in ${cwd}` : "cmux: starting terminal");
    const terminalPane = useTabLayout
      ? await cmux.newSurface({
          workspace: workspaceId,
          type: "terminal",
          focus: terminal.focus ?? true,
        })
      : await cmux.newPane({
          workspace: workspaceId,
          type: "terminal",
          direction: terminal.direction ?? "down",
          focus: terminal.focus ?? true,
        });
    terminalPanes.push(terminalPane);
    const sendOptions: CmuxSendOptions = {
      workspace: workspaceId,
      surface: terminalPane.surface,
      text: commandForTerminal(terminal, input),
    };
    await cmux.send(sendOptions);
  }

  const waitOptions = remoteReadyOptionsForInput(input);
  if (input.ssh && waitOptions) {
    logger?.("cmux: waiting for remote ports");
    await cmux.waitForRemoteReady(workspaceId, waitOptions);
  }

  if (input.ssh && terminalPanes.some((pane) => pane.surface)) {
    logger?.("cmux: refreshing remote ports");
    for (const pane of terminalPanes) {
      if (!pane.surface) continue;
      const kickOptions: CmuxPortsKickOptions = {
        workspace: workspaceId,
        surface: pane.surface,
        reason: "command",
      };
      await cmux.portsKick(kickOptions);
    }
  }

  let browserPane: CmuxPane | undefined;
  if (input.url) {
    logger?.(`cmux: opening ${input.url}`);
    browserPane = useTabLayout
      ? await cmux.newSurface({
          workspace: workspaceId,
          type: "browser",
          url: input.url,
          focus: input.focus !== false,
        })
      : await cmux.browserOpen({
          workspace: workspaceId,
          url: input.url,
          focus: input.focus !== false,
        });
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
    terminalPanes: terminalPanes.map(paneResultForCmuxPane),
    ...(browserPane ? { browserPane: paneResultForCmuxPane(browserPane) } : {}),
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
    ...optionalSurfaceLayoutField(value, "surfaceLayout"),
    ...(value.terminals !== undefined ? { terminals: parseTerminalInputs(value.terminals) } : {}),
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

function parseTerminalInputs(value: unknown): CmuxOpenTerminalInput[] {
  if (!Array.isArray(value)) throw new Error(`cmux.open terminals must be an array`);
  return value.map((item, index) => parseTerminalInput(item, index));
}

function parseTerminalInput(value: unknown, index: number): CmuxOpenTerminalInput {
  if (!isRecord(value)) throw new Error(`cmux.open terminals[${index}] must be an object`);
  return {
    command: requiredString(value, "command"),
    ...optionalStringField(value, "cwd"),
    ...optionalTerminalDirectionField(value, "direction"),
    ...optionalBooleanField(value, "focus"),
  };
}

function commandForTerminal(terminal: CmuxOpenTerminalInput, input: CmuxOpenInput): string {
  const cwd = terminal.cwd ?? input.cwd;
  const prefix = cwd ? `${formatShellCommand(["cd", cwd])} && ` : "";
  return `${prefix}${terminal.command}\n`;
}

function paneResultForCmuxPane(pane: CmuxPane): CmuxOpenPaneResult {
  return {
    ...(pane.pane ? { paneId: pane.pane } : {}),
    ...(pane.paneRef ? { paneRef: pane.paneRef } : {}),
    ...(pane.surface ? { surfaceId: pane.surface } : {}),
    ...(pane.surfaceRef ? { surfaceRef: pane.surfaceRef } : {}),
  };
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

function optionalTerminalDirectionField(
  record: Record<string, unknown>,
  key: string,
): Record<string, CmuxOpenTerminalDirection> {
  const value = record[key];
  if (value === undefined) return {};
  if (value !== "left" && value !== "right" && value !== "up" && value !== "down") {
    throw new Error(`cmux.open ${key} must be "left", "right", "up", or "down"`);
  }
  return { [key]: value };
}

function optionalSurfaceLayoutField(
  record: Record<string, unknown>,
  key: string,
): Record<string, "splits" | "tabs"> {
  const value = record[key];
  if (value === undefined) return {};
  if (value !== "splits" && value !== "tabs") {
    throw new Error(`cmux.open ${key} must be "splits" or "tabs"`);
  }
  return { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
