import {
  defineProvider,
  type LocalWorkspaceRuntime,
  type WorkflowProviderDefinition,
} from "@stoke/sdk";
import type { BaseProviderPlugin, WorkflowProviderController } from "@stoke/engine";
import {
  CMUX_CALL_CAPABILITY,
  CMUX_CALL_CAPABILITY_ID,
  type CmuxBrowserOpenInput,
  type CmuxCallInput,
  type CmuxNewPaneInput,
  type CmuxNewSurfaceInput,
  type CmuxPaneResult,
  type CmuxPortsKickInput,
  type CmuxRemoteReadyInput,
  type CmuxSendInput,
  type CmuxSshInput,
  type CmuxWorkspaceInput,
  type CmuxWorkspaceResult,
} from "./capabilities.ts";

export const CMUX_PROVIDER_ID = "cmux";

export type CmuxRuntime = {
  call(input: CmuxCallInput): Promise<unknown>;
  newWorkspace(input?: CmuxWorkspaceInput): Promise<CmuxWorkspaceResult>;
  ssh(input: CmuxSshInput): Promise<CmuxWorkspaceResult>;
  newPane(input?: CmuxNewPaneInput): Promise<CmuxPaneResult>;
  newSurface(input?: CmuxNewSurfaceInput): Promise<CmuxPaneResult>;
  browserOpen(input?: CmuxBrowserOpenInput): Promise<CmuxPaneResult>;
  send(input: CmuxSendInput): Promise<string>;
  portsKick(input: CmuxPortsKickInput): Promise<string>;
  selectWorkspace(workspace: string): Promise<void>;
  waitForRemoteReady(input: CmuxRemoteReadyInput): Promise<unknown>;
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
  capabilities: [CMUX_CALL_CAPABILITY],
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
  const request = (method: CmuxCallInput["method"], params?: Record<string, unknown>) =>
    requestCmuxCall(local, { method, ...(params ? { params } : {}) }, { nodePath });

  return {
    call: async (input) => await requestCmuxCall(local, input, { nodePath }),
    newWorkspace: async (input = {}) =>
      parseCmuxWorkspaceResult(await request("newWorkspace", input)),
    ssh: async (input) =>
      parseCmuxWorkspaceResult(await request("ssh", typeof input === "string" ? { destination: input } : input)),
    newPane: async (input = {}) => parseCmuxPaneResult(await request("newPane", input)),
    newSurface: async (input = {}) => parseCmuxPaneResult(await request("newSurface", input)),
    browserOpen: async (input = {}) => parseCmuxPaneResult(await request("browserOpen", input)),
    send: async (input) => String(await request("send", input)),
    portsKick: async (input) => String(await request("portsKick", input)),
    selectWorkspace: async (workspace) => {
      await request("selectWorkspace", { workspace });
    },
    waitForRemoteReady: async (input) => await request("waitForRemoteReady", input),
  };
}

export async function requestCmuxCall(
  local: LocalWorkspaceRuntime,
  input: CmuxCallInput,
  options: { nodePath?: string } = {},
): Promise<unknown> {
  if (!local.requestCapability) {
    throw new Error(`Host capability ${CMUX_CALL_CAPABILITY_ID} is unavailable in this runtime`);
  }
  return await local.requestCapability(CMUX_CALL_CAPABILITY_ID, input, options);
}

export function parseCmuxWorkspaceResult(value: unknown): CmuxWorkspaceResult {
  if (!isRecord(value)) throw new Error(`cmux.call returned a non-object workspace result`);
  const workspaceId = stringField(value, "workspaceId") ?? stringField(value, "id") ?? stringField(value, "handle");
  if (!workspaceId) throw new Error(`cmux.call workspace result is missing workspace id`);
  return {
    sessionId: stringField(value, "sessionId") ?? workspaceId,
    workspaceId,
    ...(stringField(value, "workspaceRef") ?? stringField(value, "ref")
      ? { workspaceRef: stringField(value, "workspaceRef") ?? stringField(value, "ref") }
      : {}),
  };
}

export function parseCmuxPaneResult(value: unknown): CmuxPaneResult {
  if (!isRecord(value)) throw new Error(`cmux.call returned a non-object pane result`);
  return {
    ...(stringField(value, "paneId") ?? stringField(value, "pane")
      ? { paneId: stringField(value, "paneId") ?? stringField(value, "pane") }
      : {}),
    ...(stringField(value, "paneRef") ?? stringField(value, "paneRef")
      ? { paneRef: stringField(value, "paneRef") ?? stringField(value, "paneRef") }
      : {}),
    ...(stringField(value, "surfaceId") ?? stringField(value, "surface")
      ? { surfaceId: stringField(value, "surfaceId") ?? stringField(value, "surface") }
      : {}),
    ...(stringField(value, "surfaceRef") ?? stringField(value, "surfaceRef")
      ? { surfaceRef: stringField(value, "surfaceRef") ?? stringField(value, "surfaceRef") }
      : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
