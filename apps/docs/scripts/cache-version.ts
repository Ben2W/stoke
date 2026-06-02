// Prints the Worker cache-busting version for the current build, e.g.
// "docs-09b1699". Each deploy stamps this into the Worker's CACHE_VERSION var
// so a new commit starts a fresh Worker cache (see the `deploy:worker` script
// in package.json). Prefers CI-provided commit SHAs, falls back to local git.
import { execSync } from "node:child_process";

function shortSha(): string {
  const fromEnv =
    process.env.WORKERS_CI_COMMIT_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);

  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // No git context (rare) — fall back to a timestamp so the deploy still
    // busts the cache rather than silently reusing a stale namespace.
    return `t${Date.now()}`;
  }
}

process.stdout.write(`docs-${shortSha()}`);
