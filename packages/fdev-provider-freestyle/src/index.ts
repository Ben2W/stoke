import {
  defineProvider,
  type DevProviderDefinition,
} from "@freestyle-sh/fdev-sdk";
import type { BaseProviderPlugin } from "@freestyle-sh/fdev-engine";
import { Freestyle } from "freestyle";
import * as z from "zod/v4-mini";
import { freestyleIdentityId, freestyleToken, freestyleTokenId } from "./auth.ts";
import { FREESTYLE_PROVIDER_ID, createFreestyleProvider } from "./provider.ts";
import type { FreestyleWorkspaceContext } from "./provider.ts";
import { freestyleSchema } from "./schema.ts";
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

export type FreestyleProviderDefinition = DevProviderDefinition<
  typeof FREESTYLE_PROVIDER_ID,
  FreestyleProviderConfig,
  FreestyleWorkspaceContext
>;

export function defineFreestyleProvider(
  config: FreestyleProviderDefinition["config"],
): FreestyleProviderDefinition {
  return defineProvider(FREESTYLE_PROVIDER_ID, config, freestyleProviderPlugin);
}

export const freestyleProviderPlugin: BaseProviderPlugin = {
  providerId: FREESTYLE_PROVIDER_ID,
  schema: freestyleSchema,
  async createProvider({ provider, db }) {
    const config = parseFreestyleProviderConfig(provider.config);
    const { apiKey, ...vm } = config;

    const store = createFreestyleStore(db);
    const savedIdentity = store.getIdentity();
    if (savedIdentity) {
      return createFreestyleProvider({
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

    return createFreestyleProvider({
      apiKey,
      identityId: createdIdentity.identityId,
      token: createdIdentity.token,
      vm,
    });
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
export { FREESTYLE_PROVIDER_ID, createFreestyleProvider } from "./provider.ts";
export { freestyleGitRelationships, freestyleIdentities, freestyleSchema } from "./schema.ts";
export { createFreestyleStore } from "./store.ts";
export { FDEV_PROVIDER_FREESTYLE_VERSION } from "./version.ts";
export type { FreestyleVmConfig, FreestyleWorkspaceContext } from "./provider.ts";
export type { FreestyleGitRelationship, FreestyleIdentity } from "./store.ts";

function parseFreestyleProviderConfig(value: unknown): FreestyleProviderConfig {
  const result = z.safeParse(freestyleProviderConfigSchema, value);
  if (!result.success) {
    throw new Error(`Invalid Freestyle provider config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
