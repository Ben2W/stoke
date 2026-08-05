import type { GitHubProjectSource } from "@stoke/managed";

const GITHUB_API_VERSION = "2022-11-28";
type GitHubFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class PublicGitHubRepositoryRequiredError extends Error {
  override name = "PublicGitHubRepositoryRequiredError";
}

export async function requirePublicGitHubRepository(
  source: GitHubProjectSource,
  fetchImplementation: GitHubFetch = (input, init) => fetch(input, init),
): Promise<{ defaultBranch: string }> {
  const repository = `${source.owner}/${source.repository}`;
  const response = await fetchImplementation(repositoryApiUrl(source), { headers: githubHeaders() });
  if (response.status === 404) throw publicRepositoryRequired(repository);
  if (!response.ok) throw new Error(`GitHub could not verify ${repository} (status ${response.status})`);
  const metadata = await response.json().catch(() => undefined);
  if (!isRecord(metadata) || metadata.private !== false) throw publicRepositoryRequired(repository);
  if (typeof metadata.default_branch !== "string" || !metadata.default_branch) {
    throw new Error(`GitHub returned invalid repository metadata for ${repository}`);
  }
  return { defaultBranch: metadata.default_branch };
}

export async function resolvePublicGitHubRevision(
  source: GitHubProjectSource,
  fetchImplementation: GitHubFetch = (input, init) => fetch(input, init),
): Promise<string> {
  const repository = `${source.owner}/${source.repository}`;
  const { defaultBranch } = await requirePublicGitHubRepository(source, fetchImplementation);
  const commitResponse = await fetchImplementation(
    `${repositoryApiUrl(source)}/commits/${encodeURIComponent(defaultBranch)}`,
    { headers: githubHeaders() },
  );
  if (!commitResponse.ok) {
    throw new Error(`GitHub could not resolve the default branch for ${repository} (status ${commitResponse.status})`);
  }
  const commit = await commitResponse.json().catch(() => undefined);
  if (!isRecord(commit) || typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
    throw new Error(`GitHub returned an invalid commit for ${repository}`);
  }
  return commit.sha;
}

function repositoryApiUrl(source: GitHubProjectSource): string {
  return `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}`;
}

function githubHeaders(): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "stoke-control-plane",
  };
}

function publicRepositoryRequired(repository: string): PublicGitHubRepositoryRequiredError {
  return new PublicGitHubRepositoryRequiredError(
    `Only public GitHub repositories can be added to Stoke. ${repository} is private or unavailable.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
