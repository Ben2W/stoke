import { existsSync, realpathSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { basename, resolve } from "node:path";
import {
  createManagedClient,
  type ManagedClient,
  type ProjectSource,
} from "@stoke/managed";

export const DEFAULT_STOKE_API_URL = "https://usestoke.dev";

export type ManagedEnvironment = Record<string, string | undefined>;

export function managedClientFromEnvironment(
  environment: ManagedEnvironment = process.env,
): ManagedClient {
  const token = environment.STOKE_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Stoke is not authenticated. Set STOKE_API_TOKEN to use managed commands.");
  }

  return createManagedClient({
    baseUrl: environment.STOKE_API_URL?.trim() || DEFAULT_STOKE_API_URL,
    token,
  });
}

export function resolveProjectSource(
  input: string,
  options: {
    cwd?: string;
    environment?: ManagedEnvironment;
  } = {},
): { name: string; source: ProjectSource } {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const localPath = resolve(cwd, input);

  if (existsSync(localPath)) {
    if (!statSync(localPath).isDirectory()) {
      throw new Error(`Local Stoke project source must be a directory: ${localPath}`);
    }
    const path = realpathSync(localPath);
    return {
      name: basename(path),
      source: {
        kind: "local",
        machineId: environment.STOKE_MACHINE_ID?.trim() || hostname(),
        machineName: environment.STOKE_MACHINE_NAME?.trim() || hostname(),
        path,
      },
    };
  }

  const repository = parseGitHubRepository(input);
  if (!repository) {
    throw new Error(
      `Could not resolve ${JSON.stringify(input)}. Pass an existing local directory or a GitHub repository such as owner/repo.`,
    );
  }

  return {
    name: repository.repository,
    source: {
      kind: "github",
      ...repository,
      url: `https://github.com/${repository.owner}/${repository.repository}`,
    },
  };
}

export function parseGitHubRepository(
  value: string,
): { owner: string; repository: string } | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|github\.com\/)?([^/\s:]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return { owner: match[1], repository: match[2] };
}
