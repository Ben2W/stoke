import { appendFileSync } from "node:fs";
import {
  bumpVersion,
  getPullRequestLabels,
  getReleaseState,
  strongestReleaseType,
} from "./lib";
import type { ReleaseType } from "./config";

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveReleaseType(prNumber: string): ReleaseType {
  const explicit = valueArg("--release-type");
  if (explicit === "patch" || explicit === "minor" || explicit === "major") {
    return explicit;
  }

  const releaseType = strongestReleaseType(getPullRequestLabels(prNumber));
  if (!releaseType) {
    throw new Error(
      `PR #${prNumber} needs release:patch, release:minor, or release:major before publishing a canary.`,
    );
  }

  return releaseType;
}

const prNumber = valueArg("--pr");
const sha = valueArg("--sha");

if (!prNumber || !sha) {
  throw new Error("Usage: bun scripts/release/canary-version.ts --pr <number> --sha <sha>");
}

const releaseType = resolveReleaseType(prNumber);
const currentVersion = getReleaseState().version;
const nextStableVersion = bumpVersion(currentVersion, releaseType);
const shaPart = sha.replace(/[^0-9A-Za-z]/g, "").slice(0, 8);
const canaryVersion = `${nextStableVersion}-pr.${prNumber}.${shaPart}`;

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${canaryVersion}\nrelease_type=${releaseType}\n`,
  );
}

console.log(canaryVersion);
