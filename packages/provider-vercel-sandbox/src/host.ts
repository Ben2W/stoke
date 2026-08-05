import { spawn, type ChildProcess } from "node:child_process";
import { defineHostCapability, type HostCapabilityHandler } from "@stoke/sdk/host";
import {
  SSH_CAPABILITY,
  parseVercelSandboxSshInput,
} from "./capabilities.ts";

export type SpawnInteractiveSsh = (sandbox: string) => ChildProcess;

export function createVercelSandboxSshHostCapability(
  options: { spawn?: SpawnInteractiveSsh } = {},
): HostCapabilityHandler {
  return defineHostCapability(SSH_CAPABILITY.id, {
    schemaHash: SSH_CAPABILITY.schemaHash,
    handle(params) {
      const input = parseVercelSandboxSshInput(params);
      const child = (options.spawn ?? spawnVercelSandboxConnect)(input.sandbox);
      return {
        attached: true,
        closed: childExit(child, input.sandbox),
      };
    },
  });
}

export const vercelSandboxHostCapabilities = [
  createVercelSandboxSshHostCapability(),
] as const;

function spawnVercelSandboxConnect(sandbox: string): ChildProcess {
  return spawn("vercel", ["sandbox", "connect", sandbox], {
    stdio: "inherit",
    env: process.env,
  });
}

function childExit(child: ChildProcess, sandbox: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `Vercel Sandbox SSH ${sandbox} ended with signal ${signal}`
          : `Vercel Sandbox SSH ${sandbox} exited with code ${code ?? "unknown"}`,
      ));
    });
  });
}
