import { join } from "node:path";
import { existsSync } from "node:fs";
import { getReleaseState, run } from "./lib";
import { releasePackages, root, tarballNameForPackage } from "./config";

function hasArg(name: string) {
  return process.argv.includes(name);
}

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dryRun = hasArg("--dry-run");
const distTag = valueArg("--tag") ?? "latest";
const state = getReleaseState();

for (const pkg of releasePackages) {
  const tarball = join(
    root,
    "dist",
    "npm",
    tarballNameForPackage(pkg.name, state.version),
  );

  if (!existsSync(tarball)) {
    throw new Error(`Missing packed tarball: ${tarball}`);
  }

  const command = [
    "npx",
    "npm@latest",
    "publish",
    tarball,
    "--access",
    "public",
    "--tag",
    distTag,
  ];

  if (dryRun) {
    command.push("--dry-run");
  }

  console.log(
    `${dryRun ? "Dry-run publishing" : "Publishing"} ${pkg.name}@${state.version} with dist-tag ${distTag}`,
  );
  run(command);
}
