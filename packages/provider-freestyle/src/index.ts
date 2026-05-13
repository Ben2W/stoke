import {
  defineProvider,
  type WorkflowProviderDefinition,
} from "@rigkit/sdk";
import type { BaseProviderPlugin } from "@rigkit/engine";
import type { WorkflowProviderController } from "@rigkit/engine";
import { Freestyle } from "freestyle";
import * as z from "zod/v4-mini";
import { freestyleIdentityId, freestyleToken, freestyleTokenId } from "./auth.ts";
import {
  FREESTYLE_PROVIDER_ID,
  FREESTYLE_TERMINAL_PROVIDER_ID,
  createFreestyleTerminalController,
  createFreestyleWorkflowProvider,
  isFreestyleVmSnapshotRef,
} from "./provider.ts";
import type { FreestyleRuntime, FreestyleTerminalRuntime } from "./provider.ts";
import { createFreestyleStore } from "./store.ts";

const freestyleProviderConfigSchema = z.object({
  apiKey: z.string().check(z.minLength(1)),
  image: z.string().check(z.minLength(1)),
  cpu: z.optional(z.number()),
  memory: z.optional(z.union([z.string(), z.number()])),
  disk: z.optional(z.union([z.string(), z.number()])),
  idleTimeoutSeconds: z.optional(z.nullable(z.number())),
});

export type FreestyleProviderConfig = z.output<typeof freestyleProviderConfigSchema>;

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
  config: FreestyleProviderDefinition["config"],
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
  createProvider({ provider, storage }) {
    const config = parseFreestyleProviderConfig(provider.config);
    const { apiKey, ...vm } = config;
    let controller: Promise<WorkflowProviderController<FreestyleRuntime>> | undefined;

    const load = async () => {
      controller ??= create();
      return await controller;
    };

    const create = async () => {
      const store = createFreestyleStore(storage);
      const savedIdentity = store.getIdentity();
      if (savedIdentity) {
        return createFreestyleWorkflowProvider({
          apiKey,
          identityId: savedIdentity.identityId,
          token: savedIdentity.token,
          vm,
        });
      }

      const client = new Freestyle({ apiKey });
      const { identity, identityId } = await client.identities.create();
      const { token, tokenId } = await identity.tokens.create();
      const createdIdentity = store.saveIdentity({
        identityId: freestyleIdentityId(identityId),
        tokenId: freestyleTokenId(tokenId),
        token: freestyleToken(token),
      });

      return createFreestyleWorkflowProvider({
        apiKey,
        identityId: createdIdentity.identityId,
        token: createdIdentity.token,
        vm,
      });
    };

    return {
      providerId: FREESTYLE_PROVIDER_ID,
      runtime: async (context) => await (await load()).runtime(context),
      validateArtifact: (ref) => isFreestyleVmSnapshotRef(ref),
    } satisfies WorkflowProviderController<FreestyleRuntime>;
  },
};

export const freestyleTerminalPlugin: BaseProviderPlugin = {
  providerId: FREESTYLE_TERMINAL_PROVIDER_ID,
  createProvider() {
    return createFreestyleTerminalController();
  },
};

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
  createFreestyleProvider,
  createFreestyleTerminalController,
  createFreestyleWorkflowController,
  createFreestyleWorkflowProvider,
  isFreestyleVmSnapshotRef,
} from "./provider.ts";
export { createFreestyleStore } from "./store.ts";
export { createFreestyleTerminalSession } from "./terminal-session.ts";
export { RIGKIT_PROVIDER_FREESTYLE_VERSION } from "./version.ts";
export type {
  FreestyleCmuxSshOptions,
  FreestyleCmuxSshOptionsInput,
  FreestyleRuntime,
  FreestyleTerminalRuntime,
  FreestyleVscodeUrlOptions,
  FreestyleVmConfig,
  FreestyleVmRuntime,
  FreestyleVmSnapshotRef,
} from "./provider.ts";
export type { FreestyleGitRelationship, FreestyleIdentity } from "./store.ts";

function parseFreestyleProviderConfig(value: unknown): FreestyleProviderConfig {
  const result = z.safeParse(freestyleProviderConfigSchema, value);
  if (!result.success) {
    throw new Error(`Invalid Freestyle provider config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
