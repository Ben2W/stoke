import {
  defineProvider,
  type LocalWorkspaceRuntime,
  type WorkflowProviderDefinition,
} from "@rigkit/sdk";
import type { BaseProviderPlugin, WorkflowProviderController } from "@rigkit/engine";
import {
  CMUX_OPEN_CAPABILITY_ID,
  type CmuxOpenInput,
  type CmuxOpenPaneResult,
  type CmuxOpenResult,
  type CmuxOpenSession,
} from "./capabilities.ts";

export const CMUX_PROVIDER_ID = "cmux";

export type CmuxRuntime = {
  open(input: CmuxOpenInput): Promise<CmuxOpenSession>;
};

export type CmuxProviderDefinition = WorkflowProviderDefinition<
  typeof CMUX_PROVIDER_ID,
  {},
  CmuxRuntime
>;

export function provider(): CmuxProviderDefinition {
  return defineProvider(CMUX_PROVIDER_ID, {}, cmuxProviderPlugin);
}

export const cmux = {
  provider,
};

export const cmuxProviderPlugin: BaseProviderPlugin = {
  providerId: CMUX_PROVIDER_ID,
  createProvider(): WorkflowProviderController<CmuxRuntime> {
    return {
      providerId: CMUX_PROVIDER_ID,
      runtime(context) {
        return createCmuxRuntime(context.local, context.nodePath);
      },
    };
  },
};

function createCmuxRuntime(local: LocalWorkspaceRuntime, nodePath: string): CmuxRuntime {
  return {
    open: async (input) => await requestCmuxOpen(local, input, { nodePath }),
  };
}

export async function requestCmuxOpen(
  local: LocalWorkspaceRuntime,
  input: CmuxOpenInput,
  options: { nodePath?: string } = {},
): Promise<CmuxOpenSession> {
  if (local.requestCapabilitySession) {
    const session = await local.requestCapabilitySession<CmuxOpenResult>(CMUX_OPEN_CAPABILITY_ID, input, options);
    return {
      ...parseCmuxOpenResult(session.result),
      closed: session.closed,
    };
  }
  if (!local.requestCapability) {
    throw new Error(`Host capability ${CMUX_OPEN_CAPABILITY_ID} is unavailable in this runtime`);
  }
  const result = parseCmuxOpenResult(
    await local.requestCapability(CMUX_OPEN_CAPABILITY_ID, input, options),
  );
  return {
    ...result,
    closed: new Promise<void>(() => {}),
  };
}

export function parseCmuxOpenResult(value: unknown): CmuxOpenResult {
  if (!isRecord(value)) throw new Error(`cmux.open returned a non-object result`);
  const sessionId = stringField(value, "sessionId");
  if (!sessionId) throw new Error(`cmux.open result is missing sessionId`);
  const workspaceId = stringField(value, "workspaceId") ?? sessionId;
  return {
    sessionId,
    workspaceId,
    ...optionalStringField(value, "workspaceRef"),
    terminalPanes: arrayField(value, "terminalPanes", parseCmuxOpenPaneResult),
    ...(value.browserPane !== undefined ? { browserPane: parseCmuxOpenPaneResult(value.browserPane) } : {}),
  };
}

function parseCmuxOpenPaneResult(value: unknown): CmuxOpenPaneResult {
  if (!isRecord(value)) throw new Error(`cmux.open returned a non-object pane result`);
  return {
    ...optionalStringField(value, "paneId"),
    ...optionalStringField(value, "paneRef"),
    ...optionalStringField(value, "surfaceId"),
    ...optionalStringField(value, "surfaceRef"),
  };
}

function arrayField<Item>(
  record: Record<string, unknown>,
  key: string,
  parseItem: (value: unknown) => Item,
): Item[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`cmux.open result ${key} must be an array`);
  return value.map(parseItem);
}

function optionalStringField(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = stringField(record, key);
  return value ? { [key]: value } : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
