import {
  assertCheckedOutVersionBranch,
  assertNpmPublishReady,
  assertVersionBranchForVersion,
  currentGitBranch,
  releaseTagFromEnv,
  runReleaseCheck,
} from "./lib";
import { assertDocsReleaseSnapshot } from "../docs/lib";

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

if (!state.version.includes("-")) {
  assertDocsReleaseSnapshot(state.version);
}

if (!skipReleaseBranch) {
  if (tag) {
    assertVersionBranchForVersion(state.version);
  } else if (currentGitBranch().startsWith("version/")) {
    assertCheckedOutVersionBranch(state.version);
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
