import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createManagedClient } from "@usestoke/managed";
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
  baseUrl?: string;
  accessToken?: string;
  projectId?: string;
};

export type VercelSandboxCreateInput = {
  runtime?: string;
  revision?: string;
  ports?: number[];
  timeout?: number;
  resources?: { vcpus: number };
};

type RunCommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
  detached?: boolean;
  timeoutMs?: number;
};
type RunCommandInput = RunCommandOptions & { cmd: string; args?: string[] };

export type VercelSandboxCommandResult = {
  readonly exitCode: number | null;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
};

export type VercelSandboxHandle = {
  readonly name: string;
  runCommand(command: string, args?: string[], options?: RunCommandOptions): Promise<VercelSandboxCommandResult>;
  runCommand(input: RunCommandInput): Promise<VercelSandboxCommandResult>;
  domain(port: number): string;
  stop(): Promise<void>;
};

export type VercelSandboxClient = {
  create(input?: VercelSandboxCreateInput): Promise<VercelSandboxHandle>;
  get(input: { name: string }): Promise<VercelSandboxHandle>;
};

export type VercelSandboxRuntime = {
  readonly client: VercelSandboxClient;
  ref(name: string): Promise<VercelSandboxHandle>;
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

export function provider(config: VercelSandboxProviderConfig = {}): VercelSandboxProviderDefinition {
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
    return {
      providerId: VERCEL_SANDBOX_PROVIDER_ID,
      runtime() {
        return createVercelSandboxRuntime(provider.config as VercelSandboxProviderConfig);
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
  const projectId = config.projectId ?? process.env.STOKE_PROJECT_ID;
  if (!projectId) throw new Error("A managed Stoke project must be selected before using Vercel Sandbox");
  const client = createManagedClient({
    baseUrl: config.baseUrl ?? process.env.STOKE_API_URL ?? "https://usestoke.dev",
    token: () => config.accessToken ?? readStokeAccessToken(),
  });
  const sandboxClient: VercelSandboxClient = {
    async create(input = {}) {
      const sandbox = await client.createSandbox({
        projectId,
        runtime: input.runtime ?? "node24",
        revision: input.revision,
        ports: input.ports ?? [],
        timeout: input.timeout,
        resources: input.resources,
      });
      return managedHandle(client, projectId, sandbox.name, sandbox.domains);
    },
    async get(input) {
      return managedHandle(client, projectId, input.name, {});
    },
  };
  return { client: sandboxClient, ref: (name) => sandboxClient.get({ name }) };
}

function managedHandle(
  client: ReturnType<typeof createManagedClient>,
  projectId: string,
  name: string,
  domains: Record<string, string>,
): VercelSandboxHandle {
  return {
    name,
    async runCommand(commandOrInput: string | RunCommandInput, args?: string[], options?: RunCommandOptions) {
      const input = typeof commandOrInput === "string"
        ? { cmd: commandOrInput, args: args ?? [], ...options }
        : commandOrInput;
      const result = await client.runSandboxCommand(name, {
        projectId,
        cmd: input.cmd,
        args: input.args ?? [],
        cwd: input.cwd,
        env: input.env,
        detached: input.detached ?? false,
        timeoutMs: input.timeoutMs,
      });
      return {
        exitCode: result.exitCode,
        stdout: async () => result.stdout,
        stderr: async () => result.stderr,
      };
    },
    domain(port) {
      const domain = domains[String(port)];
      if (!domain) throw new Error(`Port ${port} is not exposed by Vercel Sandbox ${name}`);
      return domain;
    },
    async stop() {
      await client.stopSandbox(name, projectId);
    },
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

export function readStokeAccessToken(): string | undefined {
  const tokenFile = process.env.STOKE_TOKEN_FILE?.trim();
  if (tokenFile) {
    try {
      const token = readFileSync(tokenFile, "utf8").trim();
      if (token) return token;
    } catch {
      // Fall through to the environment and the local Stoke credential.
    }
  }
  const environmentToken = process.env.STOKE_TOKEN?.trim();
  if (environmentToken) return environmentToken;
  try {
    const stokeDirectory = process.env.STOKE_HOME?.trim() || join(homedir(), ".stoke");
    const parsed = JSON.parse(readFileSync(join(stokeDirectory, "credentials.json"), "utf8")) as unknown;
    return isRecord(parsed) && typeof parsed.accessToken === "string" ? parsed.accessToken : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
