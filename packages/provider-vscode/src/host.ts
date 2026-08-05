import { spawn } from "node:child_process";
import { defineHostCapability, type HostCapabilityHandler } from "@usestoke/sdk/host";
import { parseVscodeOpenInput, VSCODE_OPEN_CAPABILITY } from "./capabilities.ts";

export function createVscodeOpenHostCapability(
  options: { open?: (authority: string, path?: string) => void | Promise<void> } = {},
): HostCapabilityHandler {
  return defineHostCapability(VSCODE_OPEN_CAPABILITY.id, {
    schemaHash: VSCODE_OPEN_CAPABILITY.schemaHash,
    async handle(params) {
      const input = parseVscodeOpenInput(params);
      await (options.open ?? openVscode)(input.authority, input.path);
      return { opened: true };
    },
  });
}

export const vscodeHostCapabilities = [createVscodeOpenHostCapability()] as const;

async function openVscode(authority: string, path?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("code", ["--remote", `ssh-remote+${authority}`, ...(path ? [path] : [])], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
