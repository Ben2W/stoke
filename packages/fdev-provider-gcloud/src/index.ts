import { defineProvider, type WorkflowProviderDefinition } from "@freestyle-sh/fdev";
import type { BaseProviderPlugin } from "@freestyle-sh/fdev-engine";
import * as z from "zod/v4-mini";
import {
  assertLocalGcloudReady,
  createGcloudConfigCopyController,
  GCLOUD_CONFIG_COPY_PROVIDER_ID,
  type GcloudConfigCopyConfig,
  type GcloudConfigCopyRuntime,
} from "./provider.ts";
import { createGcloudAuthStore } from "./store.ts";

const gcloudConfigCopyProviderConfigSchema = z.object({
  command: z.optional(z.string()),
  key: z.optional(z.string()),
  account: z.optional(z.string()),
  scopes: z.optional(z.array(z.string())),
  installUrl: z.optional(z.string()),
  accessTokenLifetimeSeconds: z.optional(z.number()),
  configDir: z.optional(z.string()),
});

export type GcloudConfigCopyProviderConfig = z.output<typeof gcloudConfigCopyProviderConfigSchema>;

export type GcloudConfigCopyProviderDefinition = WorkflowProviderDefinition<
  typeof GCLOUD_CONFIG_COPY_PROVIDER_ID,
  GcloudConfigCopyProviderConfig,
  GcloudConfigCopyRuntime
>;

export function provider(config: GcloudConfigCopyProviderDefinition["config"] = {}): GcloudConfigCopyProviderDefinition {
  return defineProvider(GCLOUD_CONFIG_COPY_PROVIDER_ID, config, gcloudConfigCopyProviderPlugin);
}

export const copyGcloudConfig = {
  provider,
};

export const defineGcloudConfigCopyProvider = provider;

export const gcloudConfigCopyProviderPlugin: BaseProviderPlugin = {
  providerId: GCLOUD_CONFIG_COPY_PROVIDER_ID,
  async createProvider({ provider, storage }) {
    const config = parseGcloudConfigCopyProviderConfig(provider.config);
    await assertLocalGcloudReady(config);
    return createGcloudConfigCopyController(config, createGcloudAuthStore(storage));
  },
};

export {
  assertLocalGcloudReady,
  DEFAULT_GCLOUD_AUTH_SCOPES,
  DEFAULT_GCLOUD_INSTALL_URL,
  GCLOUD_CONFIG_COPY_PROVIDER_ID,
  createGcloudConfigCopyController,
} from "./provider.ts";
export {
  DEFAULT_GCLOUD_ACCESS_TOKEN_EXPIRES_AT_PATH,
  DEFAULT_GCLOUD_ACCESS_TOKEN_PATH,
  DEFAULT_GCLOUD_CONFIG_DIR,
  gcloudAccessTokenFreshCommand,
  gcloudAccessTokenInjection,
  gcloudConfigCopyInjection,
  gcloudConfigCopyInjectionSteps,
  gcloudCopiedConfigReadyCommand,
} from "./inject.ts";
export { createGcloudAuthStore, normalizeScopes } from "./store.ts";
export { FDEV_PROVIDER_GCLOUD_VERSION } from "./version.ts";
export type {
  GcloudConfigCopyConfig,
  GcloudConfigCopyRuntime,
  GcloudConfigFilesOptions,
  GcloudCommandResult,
  GcloudCommandRunner,
  GcloudFreshAccessTokenOptions,
} from "./provider.ts";
export type {
  GcloudAccessCredentials,
  GcloudAccessTokenInjection,
  GcloudAccessTokenInjectionOptions,
  GcloudConfigCopy,
  GcloudConfigFile,
  GcloudConfigCopyInjection,
  GcloudConfigCopyInjectionOptions,
  GcloudConfigCopyInjectionStep,
} from "./inject.ts";
export type { GcloudCredentialsInput, GcloudStoredCredentials } from "./store.ts";

function parseGcloudConfigCopyProviderConfig(value: unknown): GcloudConfigCopyConfig {
  const result = z.safeParse(gcloudConfigCopyProviderConfigSchema, value);
  if (!result.success) {
    throw new Error(`Invalid gcloud config copy provider config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
