import {
  defineProvider,
  type WorkflowProviderDefinition,
} from "@rigkit/sdk";
import type { BaseProviderPlugin } from "@rigkit/engine";
import * as z from "zod/v4-mini";
import { freestyleIdentityId, freestyleToken, freestyleTokenId } from "./auth.ts";
import {
  createFreestyleAuthenticatedClient,
  createFreestyleProxyFetch,
  type FreestyleProviderAuthConfig,
} from "./host-auth.ts";
import {
  FREESTYLE_PROVIDER_ID,
  FREESTYLE_TERMINAL_PROVIDER_ID,
  createFreestyleTerminalController,
  createFreestyleWorkflowProvider,
} from "./provider.ts";
import type { FreestyleRuntime, FreestyleTerminalRuntime } from "./provider.ts";

const freestyleProviderConfigSchema = z.object({
  auth: z.optional(z.object({
    apiKey: z.optional(z.string().check(z.minLength(1))),
    profile: z.optional(z.string().check(z.minLength(1))),
    teamId: z.optional(z.string().check(z.minLength(1))),
    apiUrl: z.optional(z.string().check(z.minLength(1))),
    dashboardUrl: z.optional(z.string().check(z.minLength(1))),
    stackApiUrl: z.optional(z.string().check(z.minLength(1))),
    stackAppUrl: z.optional(z.string().check(z.minLength(1))),
    stackProjectId: z.optional(z.string().check(z.minLength(1))),
    stackPublishableClientKey: z.optional(z.string().check(z.minLength(1))),
  })),
});

export type FreestyleProviderConfig = z.output<typeof freestyleProviderConfigSchema>;
export type { FreestyleProviderAuthConfig };

export type FreestyleProviderDefinition = WorkflowProviderDefinition<
  typeof FREESTYLE_PROVIDER_ID,
  FreestyleProviderConfig,
  FreestyleRuntime
>;

export type FreestyleTerminalProviderDefinition = WorkflowProviderDefinition<
  typeof FREESTYLE_TERMINAL_PROVIDER_ID,
  {},
  FreestyleTerminalRuntime
>;

export function provider(
  config: FreestyleProviderDefinition["config"] = {},
): FreestyleProviderDefinition {
  return defineProvider(FREESTYLE_PROVIDER_ID, config, freestyleProviderPlugin);
}

export function terminal(): FreestyleTerminalProviderDefinition {
  return defineProvider(FREESTYLE_TERMINAL_PROVIDER_ID, {}, freestyleTerminalPlugin);
}

export const freestyle = {
  provider,
  terminal,
};

export const defineFreestyleProvider = provider;

export const freestyleProviderPlugin: BaseProviderPlugin = {
  providerId: FREESTYLE_PROVIDER_ID,
  async createProvider({ provider, hostStorage, local }) {
    const config = parseFreestyleProviderConfig(provider.config);
    const authenticated = await createFreestyleAuthenticatedClient({
      auth: config.auth,
      hostStorage,
      local,
    });
    return createFreestyleWorkflowProvider({
      client: authenticated.client,
      identityId: authenticated.identityId,
      token: authenticated.token,
    });
  },
};

export const freestyleTerminalPlugin: BaseProviderPlugin = {
  providerId: FREESTYLE_TERMINAL_PROVIDER_ID,
  createProvider() {
    return createFreestyleTerminalController();
  },
};

export {
  createFreestyleAuthenticatedClient,
  createFreestyleProxyFetch,
} from "./host-auth.ts";
export {
  freestyleIdentityId,
  freestyleToken,
  freestyleTokenId,
  type FreestyleIdentityId,
  type FreestyleToken,
  type FreestyleTokenId,
} from "./auth.ts";
export {
  FREESTYLE_PROVIDER_ID,
  FREESTYLE_TERMINAL_PROVIDER_ID,
  createFreestyleTerminalController,
  createFreestyleWorkflowController,
  createFreestyleWorkflowProvider,
} from "./provider.ts";
export { createFreestyleStore } from "./store.ts";
export { createFreestyleTerminalSession } from "./terminal-session.ts";
export { RIGKIT_PROVIDER_FREESTYLE_VERSION } from "./version.ts";
export { Freestyle, VmBaseImage, VmSpec, VmWith, VmWithInstance } from "freestyle";
export type { CreateVmOptions } from "freestyle";
export type {
  FreestyleCmuxSshOptions,
  FreestyleCmuxSshOptionsInput,
  FreestyleRuntime,
  FreestyleSdkVm,
  FreestyleSshInput,
  FreestyleTerminalRuntime,
  FreestyleVscodeUrlOptions,
} from "./provider.ts";
export type { FreestyleGitRelationship, FreestyleIdentity } from "./store.ts";

function parseFreestyleProviderConfig(value: unknown): FreestyleProviderConfig {
  const result = z.safeParse(freestyleProviderConfigSchema, value);
  if (!result.success) {
    throw new Error(`Invalid Freestyle provider config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
