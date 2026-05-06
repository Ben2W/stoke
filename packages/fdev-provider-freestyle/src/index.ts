import {
  defineProvider,
  type DevProviderDefinition,
} from "@freestyle-sh/fdev-sdk";
import type { BaseProviderPlugin } from "@freestyle-sh/fdev-engine";
import { Freestyle } from "freestyle";
import { freestyleIdentityId, freestyleToken, freestyleTokenId } from "./auth.ts";
import { FREESTYLE_PROVIDER_ID, createFreestyleProvider } from "./provider.ts";
import { freestyleSchema } from "./schema.ts";
import { createFreestyleStore } from "./store.ts";

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
  async createProvider({ provider, db }) {
    const apiKey = provider.config.apiKey;
    if (typeof apiKey !== "string" || !apiKey) {
      throw new Error(`Freestyle provider requires a resolved apiKey`);
    }

    const store = createFreestyleStore(db);
    const savedIdentity = store.getIdentity();
    if (savedIdentity) {
      return createFreestyleProvider({
        apiKey,
        identityId: savedIdentity.identityId,
        token: savedIdentity.token,
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
export type { FreestyleGitRelationship, FreestyleIdentity } from "./store.ts";
