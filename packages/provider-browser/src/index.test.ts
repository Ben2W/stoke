import { describe, expect, test } from "bun:test";
import { createBrowserOpenHostCapability } from "./host.ts";
import { browser, browserProviderPlugin } from "./index.ts";

describe("browser provider", () => {
  test("declares browser.open", () => {
    expect(browser.provider().plugin).toBe(browserProviderPlugin);
    expect(browserProviderPlugin.capabilities?.map((capability) => capability.id)).toEqual(["browser.open"]);
  });

  test("opens validated web URLs through the host", async () => {
    const opened: string[] = [];
    const host = createBrowserOpenHostCapability({ open: (url) => { opened.push(url); } });
    expect(await host.handle({ url: "https://example.com/preview" })).toEqual({ opened: true });
    expect(opened).toEqual(["https://example.com/preview"]);
    await expect(host.handle({ url: "file:///etc/passwd" })).rejects.toThrow();
  });
});
