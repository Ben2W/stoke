import type { GitHubProjectSource } from "@usestoke/managed";

const GITHUB_API_VERSION = "2022-11-28";
type GitHubFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class PublicGitHubRepositoryRequiredError extends Error {
  override name = "PublicGitHubRepositoryRequiredError";
}

export class GitHubRateLimitError extends Error {
  override name = "GitHubRateLimitError";

  constructor(message: string, readonly retryAt?: string) {
    super(message);
  }
}

export function githubSourceFromRemote(value: string): GitHubProjectSource | undefined {
  const match = value.trim().match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s:]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return {
    kind: "github",
    owner: match[1],
    repository: match[2],
    url: `https://github.com/${match[1]}/${match[2]}`,
  };
}

export async function requirePublicGitHubRepository(
  source: GitHubProjectSource,
  fetchImplementation: GitHubFetch = (input, init) => fetch(input, init),
): Promise<{ defaultBranch: string }> {
  const repository = `${source.owner}/${source.repository}`;
  const response = await fetchImplementation(repositoryApiUrl(source), { headers: githubHeaders() });
  if (response.status === 404) throw publicRepositoryRequired(repository);
  if (!response.ok) await throwGitHubRequestError(response, `verify ${repository}`);
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
    await throwGitHubRequestError(commitResponse, `resolve the default branch for ${repository}`);
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
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "stoke-control-plane",
  };
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (clientId && clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  return headers;
}

async function throwGitHubRequestError(response: Response, action: string): Promise<never> {
  const details = await response.json().catch(() => undefined);
  const githubMessage = isRecord(details) && typeof details.message === "string"
    ? details.message
    : undefined;
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = response.headers.get("retry-after");
  const rateLimited = response.status === 429 || (
    response.status === 403
    && (remaining === "0" || Boolean(retryAfter) || /rate limit/i.test(githubMessage ?? ""))
  );
  if (rateLimited) {
    throw new GitHubRateLimitError(
      `GitHub temporarily rate limited Stoke while trying to ${action}`,
      githubRetryAt(response.headers),
    );
  }
  throw new Error(`GitHub could not ${action} (status ${response.status})`);
}

function githubRetryAt(headers: Headers): string | undefined {
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isSafeInteger(reset) && reset > 0) return new Date(reset * 1_000).toISOString();
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return new Date(Date.now() + retryAfter * 1_000).toISOString();
  }
  return undefined;
}

function publicRepositoryRequired(repository: string): PublicGitHubRepositoryRequiredError {
  return new PublicGitHubRepositoryRequiredError(
    `Only public GitHub repositories can be added to Stoke. ${repository} is private or unavailable.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
