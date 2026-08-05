import { spawn } from "node:child_process";
import { defineHostCapability, type HostCapabilityHandler } from "@usestoke/sdk/host";
import { BROWSER_OPEN_CAPABILITY, parseBrowserOpenInput } from "./capabilities.ts";

export function createBrowserOpenHostCapability(
  options: { open?: (url: string) => void | Promise<void> } = {},
): HostCapabilityHandler {
  return defineHostCapability(BROWSER_OPEN_CAPABILITY.id, {
    schemaHash: BROWSER_OPEN_CAPABILITY.schemaHash,
    async handle(params) {
      const input = parseBrowserOpenInput(params);
      await (options.open ?? openBrowser)(input.url);
      return { opened: true };
    },
  });
}

export const browserHostCapabilities = [createBrowserOpenHostCapability()] as const;

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
