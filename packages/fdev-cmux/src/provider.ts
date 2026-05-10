import {
  defineProvider,
  type LocalWorkspaceRuntime,
  type WorkflowProviderDefinition,
} from "@freestyle-sh/fdev";
import type { BaseProviderPlugin, WorkflowProviderController } from "@freestyle-sh/fdev-engine";
import {
  CMUX_OPEN_CAPABILITY,
  CMUX_OPEN_CAPABILITY_ID,
  type CmuxOpenInput,
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
  capability: CMUX_OPEN_CAPABILITY,
  capabilities: {
    open: CMUX_OPEN_CAPABILITY,
  },
};

export const cmuxProviderPlugin: BaseProviderPlugin = {
  providerId: CMUX_PROVIDER_ID,
  createProvider(): WorkflowProviderController<CmuxRuntime> {
    return {
      providerId: CMUX_PROVIDER_ID,
      runtime(context) {
        return createCmuxRuntime(context.local);
      },
    };
  },
};

function createCmuxRuntime(local: LocalWorkspaceRuntime): CmuxRuntime {
  return {
    async open(input) {
      if (local.requestCapabilitySession) {
        const session = await local.requestCapabilitySession<CmuxOpenResult>(CMUX_OPEN_CAPABILITY_ID, input);
        return {
          ...parseCmuxOpenResult(session.result),
          closed: session.closed,
        };
      }
      if (!local.requestCapability) {
        throw new Error(`Host capability ${CMUX_OPEN_CAPABILITY_ID} is unavailable in this runtime`);
      }
      const result = parseCmuxOpenResult(
        await local.requestCapability(CMUX_OPEN_CAPABILITY_ID, input),
      );
      return {
        ...result,
        closed: new Promise<void>(() => {}),
      };
    },
  };
}

function parseCmuxOpenResult(value: unknown): CmuxOpenResult {
  if (!isRecord(value)) throw new Error(`cmux.open returned a non-object result`);
  const sessionId = stringField(value, "sessionId");
  if (!sessionId) throw new Error(`cmux.open result is missing sessionId`);
  const workspaceId = stringField(value, "workspaceId") ?? sessionId;
  return {
    sessionId,
    workspaceId,
    ...optionalStringField(value, "workspaceRef"),
    ...optionalStringField(value, "terminalPaneId"),
    ...optionalStringField(value, "terminalSurfaceId"),
    ...optionalStringField(value, "browserPaneId"),
    ...optionalStringField(value, "browserSurfaceId"),
  };
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
