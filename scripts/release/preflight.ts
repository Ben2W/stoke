import {
  assertCheckedOutReleaseBranch,
  assertNpmPublishReady,
  assertReleaseBranchForVersion,
  currentGitBranch,
  releaseTagFromEnv,
  runReleaseCheck,
} from "./lib";

function hasArg(name: string) {
  return process.argv.includes(name);
}

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const tag = valueArg("--tag") ?? releaseTagFromEnv();
const skipNpm = hasArg("--skip-npm");
const skipReleaseBranch = hasArg("--skip-release-branch");
const allowMissingPackageNames = hasArg("--allow-unpublished");
const allowExistingVersion = hasArg("--allow-existing-version");

const state = runReleaseCheck(tag);

if (!skipReleaseBranch) {
  if (tag) {
    assertReleaseBranchForVersion(state.version);
  } else if (currentGitBranch().startsWith("release/")) {
    assertCheckedOutReleaseBranch(state.version);
  }
}

if (!skipNpm) {
  assertNpmPublishReady({
    version: state.version,
    allowMissingPackageNames,
    allowExistingVersion,
  });
}

console.log("Release preflight passed.");
