import { describe, expect, test } from "bun:test";
import { createRun, createRunStore, requestHostCapability } from "./runs.ts";

describe("runtime host capability requests", () => {
  test("fails and releases an unanswered capability request after its timeout", async () => {
    const store = createRunStore();
    const run = createRun("preview", {});
    store.runs.set(run.id, run);

    const pending = requestHostCapability(store, run, "browser.open", {
      url: "https://example.com",
      displayName: "Open preview",
    }, { timeoutMs: 10 });
    const request = run.events[0];

    expect(request?.type).toBe("host.capability.request");
    expect("expiresAt" in request!).toBe(true);
    await expect(pending).rejects.toThrow("timed out after 1 seconds");
    expect(store.hostResponses.size).toBe(0);
    expect(run.pendingHostRequestIds.size).toBe(0);
  });
});
