import { Sandbox } from "@vercel/sandbox";
import {
  defineProvider,
  type LocalWorkspaceRuntime,
  type WorkflowProviderDefinition,
} from "@usestoke/sdk";
import type { BaseProviderPlugin, WorkflowProviderController } from "@usestoke/engine";
import {
  SSH_CAPABILITY,
  SSH_CAPABILITY_ID,
  type VercelSandboxSshInput,
} from "./capabilities.ts";

export const VERCEL_SANDBOX_PROVIDER_ID = "vercel-sandbox";
export const VERCEL_SANDBOX_TERMINAL_PROVIDER_ID = "vercel-sandbox-terminal";

export type VercelSandboxProviderConfig = {
  token?: string;
  projectId?: string;
  teamId?: string;
};

type SandboxCreateInput = NonNullable<Parameters<typeof Sandbox.create>[0]>;
type SandboxGetInput = Parameters<typeof Sandbox.get>[0];
type SandboxGetOrCreateInput = NonNullable<Parameters<typeof Sandbox.getOrCreate>[0]>;
type SandboxListInput = Parameters<typeof Sandbox.list>[0];

export type VercelSandboxClient = {
  create(input?: SandboxCreateInput): ReturnType<typeof Sandbox.create>;
  get(input: SandboxGetInput): ReturnType<typeof Sandbox.get>;
  getOrCreate(input?: SandboxGetOrCreateInput): ReturnType<typeof Sandbox.getOrCreate>;
  list(input?: SandboxListInput): ReturnType<typeof Sandbox.list>;
};

export type VercelSandboxRuntime = {
  readonly client: VercelSandboxClient;
  ref(name: string): ReturnType<typeof Sandbox.get>;
};

export type VercelSandboxTerminalRuntime = {
  open(input: Omit<VercelSandboxSshInput, "provider">): Promise<{ finished: true }>;
};

export type VercelSandboxProviderDefinition = WorkflowProviderDefinition<
  typeof VERCEL_SANDBOX_PROVIDER_ID,
  VercelSandboxProviderConfig,
  VercelSandboxRuntime
>;

export type VercelSandboxTerminalProviderDefinition = WorkflowProviderDefinition<
  typeof VERCEL_SANDBOX_TERMINAL_PROVIDER_ID,
  {},
  VercelSandboxTerminalRuntime
>;

export function provider(
  config: VercelSandboxProviderConfig = {},
): VercelSandboxProviderDefinition {
  assertCredentialConfig(config);
  return defineProvider(VERCEL_SANDBOX_PROVIDER_ID, config, vercelSandboxProviderPlugin);
}

export function terminal(): VercelSandboxTerminalProviderDefinition {
  return defineProvider(
    VERCEL_SANDBOX_TERMINAL_PROVIDER_ID,
    {},
    vercelSandboxTerminalProviderPlugin,
  );
}

export const vercelSandbox = { provider, terminal };

export const vercelSandboxProviderPlugin: BaseProviderPlugin = {
  providerId: VERCEL_SANDBOX_PROVIDER_ID,
  createProvider({ provider }): WorkflowProviderController<VercelSandboxRuntime> {
    const config = provider.config as VercelSandboxProviderConfig;
    assertCredentialConfig(config);
    return {
      providerId: VERCEL_SANDBOX_PROVIDER_ID,
      runtime() {
        return createVercelSandboxRuntime(config);
      },
    };
  },
};

export const vercelSandboxTerminalProviderPlugin: BaseProviderPlugin = {
  providerId: VERCEL_SANDBOX_TERMINAL_PROVIDER_ID,
  capabilities: [SSH_CAPABILITY],
  createProvider(): WorkflowProviderController<VercelSandboxTerminalRuntime> {
    return {
      providerId: VERCEL_SANDBOX_TERMINAL_PROVIDER_ID,
      runtime(context) {
        return createVercelSandboxTerminalRuntime(context.local, context.nodePath);
      },
    };
  },
};

export function createVercelSandboxRuntime(
  config: VercelSandboxProviderConfig = {},
): VercelSandboxRuntime {
  const credentials = credentialFields(config);
  const client: VercelSandboxClient = {
    create: (input = {}) => Sandbox.create({ ...input, ...credentials } as SandboxCreateInput),
    get: (input) => Sandbox.get({ ...input, ...credentials } as SandboxGetInput),
    getOrCreate: (input = {}) =>
      Sandbox.getOrCreate({ ...input, ...credentials } as SandboxGetOrCreateInput),
    list: (input = {}) => Sandbox.list({ ...input, ...credentials } as SandboxListInput),
  };
  return {
    client,
    ref: (name) => client.get({ name }),
  };
}

function createVercelSandboxTerminalRuntime(
  local: LocalWorkspaceRuntime,
  nodePath: string,
): VercelSandboxTerminalRuntime {
  return {
    async open(input) {
      if (!local.requestCapabilitySession) {
        throw new Error(`Host capability ${SSH_CAPABILITY_ID} is unavailable in this runtime`);
      }
      const session = await local.requestCapabilitySession<{ attached: true }>(
        SSH_CAPABILITY_ID,
        { provider: "vercel-sandbox", ...input },
        { nodePath },
      );
      await session.closed;
      return { finished: true };
    },
  };
}

function assertCredentialConfig(config: VercelSandboxProviderConfig): void {
  const fields = [config.token, config.projectId, config.teamId];
  const configured = fields.filter((value) => typeof value === "string" && value.length > 0).length;
  if (configured !== 0 && configured !== fields.length) {
    throw new Error(
      "Vercel Sandbox credentials require token, projectId, and teamId together",
    );
  }
}

function credentialFields(config: VercelSandboxProviderConfig): VercelSandboxProviderConfig {
  if (!config.token || !config.projectId || !config.teamId) return {};
  return {
    token: config.token,
    projectId: config.projectId,
    teamId: config.teamId,
  };
}
