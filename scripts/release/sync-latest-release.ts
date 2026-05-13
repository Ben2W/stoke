import { appendFileSync } from "node:fs";
import { parseVersion, versionLineForVersion } from "./config";
import { run } from "./lib";

type ReleaseLine = {
  major: number;
  minor: number;
};

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeOutput(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function normalizeTag(tag: string) {
  return tag.replace(/^refs\/tags\//, "");
}

function parseStableTag(tag: string) {
  const normalized = normalizeTag(tag);
  const match = normalized.match(/^v(\d+\.\d+\.\d+)$/);
  if (!match) {
    return undefined;
  }

  const version = match[1];
  const parsed = parseVersion(version);
  return {
    tag: normalized,
    version,
    line: { major: parsed.major, minor: parsed.minor },
    lineName: versionLineForVersion(version),
  };
}

function compareLine(a: ReleaseLine, b: ReleaseLine) {
  if (a.major !== b.major) {
    return a.major - b.major;
  }

  return a.minor - b.minor;
}

function lineName(line: ReleaseLine) {
  return `${line.major}.${line.minor}`;
}

function skip(reason: string) {
  console.log(reason);
  writeOutput("should_sync", "false");
}

const tagArg = valueArg("--tag");
if (!tagArg) {
  throw new Error("Usage: bun scripts/release/sync-latest-release.ts --tag vX.Y.Z");
}

const release = parseStableTag(tagArg);
if (!release) {
  skip(`${normalizeTag(tagArg)} is not a stable release tag; skipping main sync.`);
  process.exit(0);
}

run(
  [
    "git",
    "fetch",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    "+refs/heads/release/*:refs/remotes/origin/release/*",
    "+refs/tags/*:refs/tags/*",
  ],
  { quiet: true },
);

const stableTags = run(["git", "tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"], {
  quiet: true,
}).stdout
  .split("\n")
  .map((tag) => parseStableTag(tag.trim()))
  .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));

if (stableTags.length === 0) {
  skip("No stable release tags found; skipping main sync.");
  process.exit(0);
}

const latestLine = stableTags.reduce((latest, tag) =>
  compareLine(tag.line, latest.line) > 0 ? tag : latest,
);

if (compareLine(release.line, latestLine.line) !== 0) {
  skip(
    `${release.tag} belongs to release/${release.lineName}, but the latest released line is release/${latestLine.lineName}; skipping main sync.`,
  );
  process.exit(0);
}

const releaseBranch = `release/${release.lineName}`;
const syncBranch = `automation/sync-release-${release.lineName}-to-main`;
const releaseBranchExists = run(
  ["git", "rev-parse", "--verify", `origin/${releaseBranch}`],
  { allowFailure: true, quiet: true },
);

if (releaseBranchExists.exitCode !== 0) {
  throw new Error(`${releaseBranch} does not exist on origin.`);
}

const mainAlreadyContainsRelease = run(
  ["git", "merge-base", "--is-ancestor", `origin/${releaseBranch}`, "origin/main"],
  { allowFailure: true, quiet: true },
);

if (mainAlreadyContainsRelease.exitCode === 0) {
  skip(`main already contains ${releaseBranch}; skipping main sync.`);
  process.exit(0);
}

if (mainAlreadyContainsRelease.exitCode !== 1) {
  throw new Error(`Could not compare origin/${releaseBranch} with origin/main.`);
}

writeOutput("should_sync", "true");
writeOutput("tag", release.tag);
writeOutput("version", release.version);
writeOutput("release_line", release.lineName);
writeOutput("release_branch", releaseBranch);
writeOutput("sync_branch", syncBranch);

console.log(
  `${release.tag} is on the latest released line ${releaseBranch}; sync back to main is required.`,
);
