import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultFdevHome } from "@freestyle-sh/fdev-runtime-client";
import { DEFAULT_CONFIG_FILE } from "./project.ts";

export type GithubProjectTarget = {
  kind: "github";
  raw: string;
  owner: string;
  repo: string;
  ref?: string;
};

export type MaterializedGithubProject = {
  target: GithubProjectTarget;
  projectId: string;
  projectDir: string;
  configPath: string;
  statePath: string;
  commitSha: string;
  ref: string;
  repoUrl: string;
};

type GithubRepoInfo = {
  default_branch?: unknown;
};

type GithubCommitInfo = {
  sha?: unknown;
};

export function parseGithubProjectTarget(value: string): GithubProjectTarget | undefined {
  const match = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:(?:#|@)(.+))?$/.exec(value);
  if (!match) return undefined;
  const owner = match[1]!;
  const repo = match[2]!.replace(/\.git$/, "");
  const ref = match[3]?.trim() || undefined;
  if (!repo) return undefined;
  return {
    kind: "github",
    raw: value,
    owner,
    repo,
    ...(ref ? { ref } : {}),
  };
}

export function splitGithubProjectTarget(args: string[]): {
  target?: GithubProjectTarget;
  args: string[];
} {
  const first = args[0];
  const target = first ? parseGithubProjectTarget(first) : undefined;
  if (!target) return { args };
  return { target, args: args.slice(1) };
}

export async function materializeGithubProject(
  target: GithubProjectTarget,
  options: { fdevHome?: string } = {},
): Promise<MaterializedGithubProject> {
  const repoUrl = `https://github.com/${target.owner}/${target.repo}.git`;
  const ref = target.ref ?? await readDefaultBranch(target);
  const commitSha = await resolveCommitSha(target, ref);
  const projectId = remoteProjectId({ repoUrl, ref, commitSha, configPath: DEFAULT_CONFIG_FILE });
  const projectRoot = join(options.fdevHome ?? defaultFdevHome(), "projects", projectId);
  const projectDir = join(projectRoot, "checkout");
  const configPath = join(projectDir, DEFAULT_CONFIG_FILE);
  const statePath = join(projectRoot, "state.sqlite");

  if (!existsSync(configPath)) {
    await downloadGithubTarball(target, commitSha, projectDir);
  }

  if (!existsSync(configPath)) {
    throw new Error(`Remote project ${target.raw} does not contain ${DEFAULT_CONFIG_FILE}`);
  }

  installProjectDependenciesIfNeeded(projectDir);

  return {
    target,
    projectId,
    projectDir,
    configPath,
    statePath,
    commitSha,
    ref,
    repoUrl,
  };
}

export function remoteProjectId(input: {
  repoUrl: string;
  ref: string;
  commitSha: string;
  configPath: string;
}): string {
  const hash = createHash("sha256").update(JSON.stringify({
    repoUrl: input.repoUrl,
    ref: input.ref,
    commitSha: input.commitSha,
    configPath: input.configPath,
  })).digest("hex").slice(0, 32);
  return `github-${hash}`;
}

function installProjectDependenciesIfNeeded(projectDir: string): void {
  if (existsSync(runtimeBinPath(projectDir))) return;
  if (!existsSync(join(projectDir, "package.json"))) {
    throw new Error(`Remote project at ${projectDir} does not contain package.json`);
  }

  const command = installCommandFor(projectDir);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Failed to run ${command.join(" ")} in ${projectDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed in ${projectDir} with exit code ${result.status}`);
  }
}

function installCommandFor(projectDir: string): string[] {
  if (existsSync(join(projectDir, "bun.lock")) || existsSync(join(projectDir, "bun.lockb"))) return ["bun", "install"];
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return ["pnpm", "install"];
  if (existsSync(join(projectDir, "package-lock.json"))) return ["npm", "install"];
  return ["npm", "install"];
}

function runtimeBinPath(projectDir: string): string {
  return join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "fdev-project-runtime.cmd" : "fdev-project-runtime");
}

async function readDefaultBranch(target: GithubProjectTarget): Promise<string> {
  const info = await githubJson<GithubRepoInfo>(`/repos/${target.owner}/${target.repo}`);
  if (typeof info.default_branch !== "string" || !info.default_branch) {
    throw new Error(`GitHub did not return a default branch for ${target.owner}/${target.repo}`);
  }
  return info.default_branch;
}

async function resolveCommitSha(target: GithubProjectTarget, ref: string): Promise<string> {
  const commit = await githubJson<GithubCommitInfo>(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(ref)}`);
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
    throw new Error(`GitHub did not return a commit SHA for ${target.owner}/${target.repo}@${ref}`);
  }
  return commit.sha;
}

async function downloadGithubTarball(
  target: GithubProjectTarget,
  commitSha: string,
  projectDir: string,
): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "fdev-github-"));
  const archivePath = join(tempDir, "source.tar.gz");
  const extractDir = join(tempDir, "extract");
  mkdirSync(extractDir, { recursive: true });

  try {
    const response = await fetch(`https://codeload.github.com/${target.owner}/${target.repo}/tar.gz/${commitSha}`, {
      headers: githubHeaders(),
    });
    if (!response.ok) {
      throw new Error(`GitHub archive download failed for ${target.raw}: ${response.status} ${response.statusText}`);
    }

    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

    const tar = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
      stdio: "inherit",
    });
    if (tar.error) throw new Error(`Failed to extract GitHub archive: ${tar.error.message}`);
    if (tar.status !== 0) throw new Error(`Failed to extract GitHub archive: tar exited ${tar.status}`);

    const roots = readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (roots.length !== 1) {
      throw new Error(`GitHub archive for ${target.raw} had ${roots.length} root directories`);
    }

    mkdirSync(dirname(projectDir), { recursive: true });
    rmSync(projectDir, { recursive: true, force: true });
    cpSync(join(extractDir, roots[0]!.name), projectDir, { recursive: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function githubJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub request failed for ${path}: ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return await response.json() as T;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "fdev-cli",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}
