import { appendFileSync } from "node:fs";
import {
  bumpAllReleaseVersions,
  bumpVersion,
  getMergedPullRequestNumbersSinceLastTag,
  getPullRequestLabels,
  getReleaseState,
  strongestReleaseType,
} from "./lib";
import { versionLineForVersion, type ReleaseType } from "./config";

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveReleaseType(input: string | undefined): ReleaseType {
  if (input === "patch" || input === "minor" || input === "major") {
    return input;
  }

  if (input && input !== "auto") {
    throw new Error(`Invalid release type: ${input}`);
  }

  const prNumbers = getMergedPullRequestNumbersSinceLastTag();
  const labels = prNumbers.flatMap((prNumber) => getPullRequestLabels(prNumber));
  const releaseType = strongestReleaseType(labels);

  if (!releaseType) {
    throw new Error(
      "Could not infer a release type from merged PR labels since the last tag.",
    );
  }

  return releaseType;
}

const targetBranch = valueArg("--target-branch");
const currentVersion = getReleaseState().version;
const releaseType = resolveReleaseType(valueArg("--release-type"));
const nextVersion = bumpVersion(currentVersion, releaseType);
const expectedTargetBranch = `release/${versionLineForVersion(nextVersion)}`;

if (targetBranch && targetBranch !== expectedTargetBranch) {
  throw new Error(
    `${releaseType} release ${nextVersion} must target ${expectedTargetBranch}, got ${targetBranch}`,
  );
}

bumpAllReleaseVersions(nextVersion);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${nextVersion}\nrelease_type=${releaseType}\n`,
  );
}

console.log(`Prepared ${releaseType} release ${nextVersion}`);
