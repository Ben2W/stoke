import { cmux } from "@rigkit/provider-cmux";
import { freestyle } from "@rigkit/provider-freestyle";

export const freestyleProvider = freestyle.provider();
export const terminalProvider = freestyle.terminal();
export const cmuxProvider = cmux.provider();

export type SetupProviders = {
  freestyle: typeof freestyleProvider;
  terminal: typeof terminalProvider;
};

export type WebsiteProviders = SetupProviders & {
  cmux: typeof cmuxProvider;
};
