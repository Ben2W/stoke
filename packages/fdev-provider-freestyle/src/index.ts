import { defineProvider, type DevProviderDefinition } from "@freestyle-sh/fdev-sdk";
import type { BaseProviderPlugin } from "@freestyle-sh/fdev-engine";
import { FREESTYLE_PROVIDER_ID, createFreestyleProvider } from "./provider.ts";
import { freestyleSchema } from "./schema.ts";

export type FreestyleProviderConfig = {
  apiKey: string;
};

export type FreestyleProviderDefinition = DevProviderDefinition<
  typeof FREESTYLE_PROVIDER_ID,
  FreestyleProviderConfig
>;

export function defineFreestyleProvider(
  config: FreestyleProviderDefinition["config"],
): FreestyleProviderDefinition {
  return defineProvider(FREESTYLE_PROVIDER_ID, config, freestyleProviderPlugin);
}

export const freestyleProviderPlugin: BaseProviderPlugin = {
  providerId: FREESTYLE_PROVIDER_ID,
  schema: freestyleSchema,
  createProvider({ provider }) {
    const apiKey = provider.config.apiKey;
    if (typeof apiKey !== "string" || !apiKey) {
      throw new Error(`Freestyle provider requires a resolved apiKey`);
    }
    return createFreestyleProvider({ apiKey });
  },
};

export { FREESTYLE_PROVIDER_ID, createFreestyleProvider } from "./provider.ts";
export { freestyleGitRelationships, freestyleSchema } from "./schema.ts";
export { createFreestyleStore } from "./store.ts";
export { FDEV_PROVIDER_FREESTYLE_VERSION } from "./version.ts";
export type { FreestyleGitRelationship } from "./store.ts";
