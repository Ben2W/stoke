import { appendFileSync } from "node:fs";
import { bumpAllReleaseVersions } from "./lib";
import { createReleasePlan } from "./plan";
import type { ReleaseType } from "./config";

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function releaseTypeArg(): ReleaseType {
  const value = valueArg("--release-type");
  if (value === "patch" || value === "minor" || value === "major") {
    return value;
  }

  throw new Error("Usage: pnpm release:prepare -- --release-type <patch|minor|major>");
}

const plan = createReleasePlan(releaseTypeArg());
bumpAllReleaseVersions(plan.version);

if (process.env.GITHUB_OUTPUT) {
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

console.log(`Prepared ${plan.releaseType} release ${plan.version}`);
