import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateStore } from "@freestyle-sh/fdev-engine";
import { freestyleIdentityId, freestyleToken, freestyleTokenId } from "./auth.ts";
import { createFreestyleStore } from "./store.ts";

describe("createFreestyleStore", () => {
  test("saves and reuses a single default identity row", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-provider-freestyle-"));
    const state = createStateStore({ projectDir });
    await state.syncSchema();

    const store = createFreestyleStore(state.providerStorage("freestyle"));

    expect(store.getIdentity()).toBeUndefined();

    const first = store.saveIdentity({
      identityId: freestyleIdentityId("identity-1"),
      tokenId: freestyleTokenId("token-id-1"),
      token: freestyleToken("token-1"),
    });
    expect(store.getIdentity()).toEqual(first);

    const identityId = freestyleIdentityId("identity-2");
    const tokenId = freestyleTokenId("token-id-2");
    const token = freestyleToken("token-2");
    const second = store.saveIdentity({ identityId, tokenId, token });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.identityId).toBe(identityId);
    expect(second.tokenId).toBe(tokenId);
    expect(second.token).toBe(token);
    expect(store.getIdentity()?.identityId).toBe(identityId);
    expect(store.getIdentity()?.token).toBe(token);
  });
});
