import {
  createCmuxClient,
  type CmuxBrowserOpenOptions,
  type CmuxClient,
  type CmuxClientOptions,
  type CmuxNewPaneOptions,
  type CmuxNewSurfaceOptions,
  type CmuxNewWorkspaceOptions,
  type CmuxPortsKickOptions,
  type CmuxSendOptions,
  type CmuxSshOptions,
  type CmuxWaitForRemoteOptions,
} from "./index.ts";
import {
  defineHostCapability,
  type HostCapabilityContext,
  type HostCapabilityHandler,
} from "@usestoke/sdk/host";
import {
  CMUX_CALL_CAPABILITY,
  type CmuxCallInput,
  type CmuxSshInput,
} from "./capabilities.ts";

export type CmuxHostCapabilityHandler = HostCapabilityHandler;

export type CmuxCallClient = Pick<
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

export type CmuxCallHostOptions = {
  client?: CmuxCallClient;
  clientOptions?: CmuxClientOptions;
  logger?: (message: string) => void;
};

export function createCmuxCallHostCapability(
  options: CmuxCallHostOptions = {},
): CmuxHostCapabilityHandler {
  return defineHostCapability(CMUX_CALL_CAPABILITY.id, {
    schemaHash: CMUX_CALL_CAPABILITY.schemaHash,
    handle: async (params, context) =>
      await callCmux(params, {
        ...options,
        logger: options.logger ?? hostCapabilityLogger(context) ?? options.clientOptions?.logger,
      }),
  });
}

export const cmuxHostCapabilities = [createCmuxCallHostCapability()] as const;

export async function callCmux(
  params: unknown,
  options: CmuxCallHostOptions = {},
): Promise<unknown> {
  const input = parseCmuxCallInput(params);
  const logger = cmuxCallLogger(options);
  const cmux = options.client ?? createCmuxClient({
    ...options.clientOptions,
    ...(options.logger ? { logger: options.logger } : {}),
    printCommands: options.clientOptions?.printCommands ?? false,
  });

  logger?.(`cmux: ${input.method}`);
  switch (input.method) {
    case "newWorkspace":
      return await cmux.newWorkspace(input.params as CmuxNewWorkspaceOptions);
    case "ssh":
      return await cmux.ssh(cmuxSshOptionsForInput(input.params));
    case "newPane":
      return await cmux.newPane(input.params as CmuxNewPaneOptions);
    case "newSurface":
      return await cmux.newSurface(input.params as CmuxNewSurfaceOptions);
    case "browserOpen":
      return await cmux.browserOpen(input.params as CmuxBrowserOpenOptions);
    case "send":
      return await cmux.send(input.params as CmuxSendOptions);
    case "portsKick":
      return await cmux.portsKick(input.params as CmuxPortsKickOptions);
    case "selectWorkspace":
      await cmux.selectWorkspace(requiredString(input.params, "workspace"));
      return "OK";
    case "waitForRemoteReady": {
      const { workspace, ...waitOptions } = input.params;
      if (typeof workspace !== "string" || workspace.trim() === "") {
        throw new Error(`cmux.call waitForRemoteReady requires params.workspace`);
      }
      return await cmux.waitForRemoteReady(workspace, waitOptions as CmuxWaitForRemoteOptions);
    }
  }
}

function cmuxCallLogger(options: CmuxCallHostOptions): ((message: string) => void) | undefined {
  return options.logger ?? options.clientOptions?.logger;
}

function hostCapabilityLogger(context: HostCapabilityContext | undefined): ((message: string) => void) | undefined {
  if (!context) return undefined;
  return (message) => context.log(message, { label: "cmux" });
}

export function parseCmuxCallInput(value: unknown): CmuxCallInput & { params: Record<string, unknown> } {
  if (!isRecord(value)) throw new Error(`cmux.call requires an object input`);
  const method = requiredString(value, "method");
  if (!isCmuxCallMethod(method)) {
    throw new Error(`cmux.call method is not supported: ${method}`);
  }
  const params = value.params === undefined ? {} : value.params;
  if (!isRecord(params)) throw new Error(`cmux.call params must be an object`);
  return { method, params };
}

function isCmuxCallMethod(value: string): value is CmuxCallInput["method"] {
  return [
    "newWorkspace",
    "ssh",
    "newPane",
    "newSurface",
    "browserOpen",
    "send",
    "portsKick",
    "selectWorkspace",
    "waitForRemoteReady",
  ].includes(value);
}

function cmuxSshOptionsForInput(ssh: Record<string, unknown>): CmuxSshOptions {
  const parsed = parseSshInput(ssh);
  if (typeof parsed === "string") return { destination: parsed };

  const destination = parsed.destination ?? sshDestination(parsed);
  return {
    destination,
    ...(parsed.port !== undefined ? { port: parsed.port } : {}),
    ...(parsed.identity !== undefined ? { identity: parsed.identity } : {}),
    ...(parsed.sshOptions?.length ? { sshOptions: parsed.sshOptions } : {}),
    ...(parsed.remoteCommandArgs !== undefined ? { remoteCommandArgs: parsed.remoteCommandArgs } : {}),
    ...(parsed.initialCommand !== undefined ? { initialCommand: parsed.initialCommand } : {}),
    ...(parsed.terminalStartupCommand !== undefined ? { terminalStartupCommand: parsed.terminalStartupCommand } : {}),
    ...(parsed.autoConnect !== undefined ? { autoConnect: parsed.autoConnect } : {}),
    ...(parsed.skipDaemonBootstrap !== undefined ? { skipDaemonBootstrap: parsed.skipDaemonBootstrap } : {}),
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.noFocus !== undefined ? { noFocus: parsed.noFocus } : {}),
  };
}

function parseSshInput(value: unknown): CmuxSshInput {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) throw new Error(`cmux.call ssh params must be an object`);
  if (value.kind !== undefined && value.kind !== "ssh") {
    throw new Error(`cmux.call ssh.kind must be "ssh"`);
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
    ...optionalStringField(value, "name"),
    ...optionalBooleanField(value, "noFocus"),
  };
}

function sshDestination(ssh: Extract<CmuxSshInput, object>): string {
  if (!ssh.host) throw new Error(`cmux.call ssh.host is required when ssh.destination is omitted`);
  if (!ssh.username) throw new Error(`cmux.call ssh.username is required when ssh.destination is omitted`);
  return `${ssh.username}@${ssh.host}`;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`cmux.call ${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`cmux.call ${key} must be a non-empty string`);
  }
  return { [key]: value.trim() };
}

function optionalStringArrayField(
  record: Record<string, unknown>,
  key: string,
): Record<string, string[]> {
  const value = record[key];
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`cmux.call ${key} must be an array of strings`);
  }
  return { [key]: value.map((item) => item.trim()) };
}

function optionalNumberField(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`cmux.call ${key} must be a finite number`);
  }
  return { [key]: value };
}

function optionalBooleanField(record: Record<string, unknown>, key: string): Record<string, boolean> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw new Error(`cmux.call ${key} must be a boolean`);
  return { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
