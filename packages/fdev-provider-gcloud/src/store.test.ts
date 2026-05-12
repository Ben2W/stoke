import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateStore } from "@freestyle-sh/fdev-engine";
import { createGcloudAuthStore } from "./store.ts";

describe("gcloud auth store", () => {
  test("upserts local access token credentials", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "fdev-gcloud-"));
    const state = createStateStore({ projectDir });
    await state.syncSchema();
    const store = createGcloudAuthStore(state.providerStorage("gcloud.config.copy"));

    const first = store.saveCredentials({
      account: "dev@example.com",
      scopes: ["openid", "https://www.googleapis.com/auth/cloud-platform"],
      accessToken: "access-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const second = store.saveCredentials({
      scopes: ["https://www.googleapis.com/auth/cloud-platform", "openid"],
      accessToken: "access-2",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });

    expect(second.id).toBe(first.id);
    expect(second.account).toBe("dev@example.com");
    expect(second.accessToken).toBe("access-2");
    expect(second.scopes).toEqual(["https://www.googleapis.com/auth/cloud-platform", "openid"]);
    expect(store.getCredentials()?.accessToken).toBe("access-2");
  });
});
