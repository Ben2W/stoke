import { bumpAllReleaseVersions, getReleaseState, resolveBumpVersion } from "./lib";

const input = process.argv[2];

if (!input) {
  throw new Error("Usage: bun scripts/release/bump.ts <patch|minor|major|x.y.z>");
}

const currentVersion = getReleaseState().version;
const nextVersion = resolveBumpVersion(input, currentVersion);

if (nextVersion === currentVersion) {
  throw new Error(`Release version is already ${nextVersion}`);
}

bumpAllReleaseVersions(nextVersion);
console.log(`Updated release packages from ${currentVersion} to ${nextVersion}`);
