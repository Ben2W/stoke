import {
  defineProvider,
  type LocalWorkspaceRuntime,
  type WorkflowProviderDefinition,
} from "@usestoke/sdk";
import type { BaseProviderPlugin, WorkflowProviderController } from "@usestoke/engine";
import { BROWSER_OPEN_CAPABILITY, BROWSER_OPEN_CAPABILITY_ID } from "./capabilities.ts";

export const BROWSER_PROVIDER_ID = "browser";

export type BrowserRuntime = {
  open(input: { url: string; displayName: string }): Promise<{ opened: true }>;
};

export type BrowserProviderDefinition = WorkflowProviderDefinition<
  typeof BROWSER_PROVIDER_ID,
  {},
  BrowserRuntime
>;

export function provider(): BrowserProviderDefinition {
  return defineProvider(BROWSER_PROVIDER_ID, {}, browserProviderPlugin);
}

export const browser = { provider };

export const browserProviderPlugin: BaseProviderPlugin = {
  providerId: BROWSER_PROVIDER_ID,
  capabilities: [BROWSER_OPEN_CAPABILITY],
  createProvider(): WorkflowProviderController<BrowserRuntime> {
    return {
      providerId: BROWSER_PROVIDER_ID,
      runtime(context) {
        return createBrowserRuntime(context.local, context.nodePath);
      },
    };
  },
};

function createBrowserRuntime(local: LocalWorkspaceRuntime, nodePath: string): BrowserRuntime {
  return {
    async open(input) {
      if (!local.requestCapability) {
        throw new Error(`Host capability ${BROWSER_OPEN_CAPABILITY_ID} is unavailable in this runtime`);
      }
      return await local.requestCapability<{ opened: true }>(
        BROWSER_OPEN_CAPABILITY_ID,
        input,
        { nodePath },
      );
    },
  };
}
