import { appendFileSync } from "node:fs";
import {
  bumpVersion,
  currentGitBranch,
  getReleaseState,
} from "./lib";
import { versionLineForVersion, type ReleaseType } from "./config";

export type ReleasePlan = {
  releaseType: ReleaseType;
  currentVersion: string;
  version: string;
  targetBranch: string;
  createReleaseBranch: boolean;
  sourceBranch: string;
};

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function releaseTypeArg(): ReleaseType {
  const value = valueArg("--release-type");
  if (value === "patch" || value === "minor" || value === "major") {
    return value;
  }

  throw new Error("Usage: pnpm release:plan -- --release-type <patch|minor|major>");
}

export function createReleasePlan(releaseType: ReleaseType): ReleasePlan {
  const sourceBranch = process.env.GITHUB_REF_NAME || currentGitBranch();
  const currentVersion = getReleaseState().version;
  const version = bumpVersion(currentVersion, releaseType);
  const targetBranch = `release/${versionLineForVersion(version)}`;

  if (releaseType === "patch") {
    if (!sourceBranch.startsWith("release/")) {
      throw new Error(
        `Patch releases must be prepared from the release branch dropdown, got ${sourceBranch}`,
      );
    }

    if (sourceBranch !== targetBranch) {
      throw new Error(
        `Patch release ${version} must run from ${targetBranch}, got ${sourceBranch}`,
      );
    }

    return {
      releaseType,
      currentVersion,
      version,
      targetBranch,
      createReleaseBranch: false,
      sourceBranch,
    };
  }

  if (sourceBranch !== "main") {
    throw new Error(
      `${releaseType} releases must be prepared from main, got ${sourceBranch}`,
    );
  }

  return {
    releaseType,
    currentVersion,
    version,
    targetBranch,
    createReleaseBranch: true,
    sourceBranch,
  };
}

function writeOutput(plan: ReleasePlan) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `release_type=${plan.releaseType}`,
      `current_version=${plan.currentVersion}`,
      `version=${plan.version}`,
      `target_branch=${plan.targetBranch}`,
      `create_release_branch=${plan.createReleaseBranch}`,
      `source_branch=${plan.sourceBranch}`,
      "",
    ].join("\n"),
  );
}

if (import.meta.main) {
  const plan = createReleasePlan(releaseTypeArg());
  const expectedVersion = valueArg("--expected-version");
  if (expectedVersion && expectedVersion !== plan.version) {
    throw new Error(
      `Selected release version ${expectedVersion} does not match computed version ${plan.version}`,
    );
  }

  writeOutput(plan);

  console.log(`Release type: ${plan.releaseType}`);
  console.log(`Current version: ${plan.currentVersion}`);
  console.log(`Next version: ${plan.version}`);
  console.log(`Target branch: ${plan.targetBranch}`);
  console.log(`Create release branch: ${plan.createReleaseBranch}`);
}
