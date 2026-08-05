import {
  defineProvider,
  type LocalWorkspaceRuntime,
  type WorkflowProviderDefinition,
} from "@usestoke/sdk";
import type { BaseProviderPlugin, WorkflowProviderController } from "@usestoke/engine";
import { VSCODE_OPEN_CAPABILITY, VSCODE_OPEN_CAPABILITY_ID, type VscodeOpenInput } from "./capabilities.ts";

export const VSCODE_PROVIDER_ID = "vscode";
export type VscodeRuntime = { open(input: VscodeOpenInput): Promise<{ opened: true }> };
export type VscodeProviderDefinition = WorkflowProviderDefinition<typeof VSCODE_PROVIDER_ID, {}, VscodeRuntime>;

export function provider(): VscodeProviderDefinition {
  return defineProvider(VSCODE_PROVIDER_ID, {}, vscodeProviderPlugin);
}
export const vscode = { provider };

export const vscodeProviderPlugin: BaseProviderPlugin = {
  providerId: VSCODE_PROVIDER_ID,
  capabilities: [VSCODE_OPEN_CAPABILITY],
  createProvider(): WorkflowProviderController<VscodeRuntime> {
    return {
      providerId: VSCODE_PROVIDER_ID,
      runtime(context) {
        return createVscodeRuntime(context.local, context.nodePath);
      },
    };
  },
};

function createVscodeRuntime(local: LocalWorkspaceRuntime, nodePath: string): VscodeRuntime {
  return {
    async open(input) {
      if (!local.requestCapability) {
        throw new Error(`Host capability ${VSCODE_OPEN_CAPABILITY_ID} is unavailable in this runtime`);
      }
      return await local.requestCapability<{ opened: true }>(VSCODE_OPEN_CAPABILITY_ID, input, { nodePath });
    },
  };
}
