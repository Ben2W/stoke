import { browserHostCapabilities } from "@usestoke/provider-browser/host";
import { cmuxHostCapabilities } from "@usestoke/provider-cmux/host";
import { vercelSandboxHostCapabilities } from "@usestoke/provider-vercel-sandbox/host";
import { vscodeHostCapabilities } from "@usestoke/provider-vscode/host";
import type { HostCapabilityHandler } from "@usestoke/sdk/host";

export type HostCapabilityDescriptor = { id: string; schemaHash?: string };

export const CLI_HOST_CAPABILITY_HANDLERS = new Map<string, HostCapabilityHandler>(
  [...browserHostCapabilities, ...cmuxHostCapabilities, ...vercelSandboxHostCapabilities, ...vscodeHostCapabilities]
    .map((capability) => [capability.id, capability]),
);

const CLI_HOST_CAPABILITIES: HostCapabilityDescriptor[] = [
  ...CLI_HOST_CAPABILITY_HANDLERS.values(),
].map((capability) => ({
  id: capability.id,
  ...(capability.schemaHash ? { schemaHash: capability.schemaHash } : {}),
}));

export function effectiveCliHostCapabilities(
  environment: Record<string, string | undefined> = process.env,
): HostCapabilityDescriptor[] {
  if (environment.STOKE_WORKSPACE_ORIGIN !== "dashboard") return CLI_HOST_CAPABILITIES;
  return CLI_HOST_CAPABILITIES.filter((capability) =>
    capability.id === "browser.open" || capability.id === "ssh"
  );
}

export function assertHostCapabilities(
  operation: { id: string; requiredCapabilities?: HostCapabilityDescriptor[] },
  available: HostCapabilityDescriptor[],
): void {
  const capabilities = new Map(available.map((capability) => [capability.id, capability]));
  for (const required of operation.requiredCapabilities ?? []) {
    const provided = capabilities.get(required.id);
    if (!provided) {
      throw new Error(
        `Operation ${operation.id} requires host capability "${required.id}", ` +
          "which is unavailable from this host.",
      );
    }
    if (required.schemaHash && required.schemaHash !== provided.schemaHash) {
      throw new Error(
        `Operation ${operation.id} requires host capability "${required.id}" ` +
          `with schema ${required.schemaHash}, but this host provides ` +
          `${provided.schemaHash ?? "no schema hash"}.`,
      );
    }
  }
}
