import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packages = [
  {
    name: "@freestyle-sh/fdev-sdk",
    dir: "packages/fdev-sdk",
    versionFile: "packages/fdev-sdk/src/version.ts",
    constant: "FDEV_SDK_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-engine",
    dir: "packages/fdev-engine",
    versionFile: "packages/fdev-engine/src/version.ts",
    constant: "FDEV_ENGINE_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-provider-freestyle",
    dir: "packages/fdev-provider-freestyle",
    versionFile: "packages/fdev-provider-freestyle/src/version.ts",
    constant: "FDEV_PROVIDER_FREESTYLE_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-cli",
    dir: "packages/fdev-cli",
    versionFile: "packages/fdev-cli/src/version.ts",
    constant: "FDEV_CLI_VERSION",
  },
];

const versions = packages.map((pkg) => {
  const packageJson = readJson(join(root, pkg.dir, "package.json")) as { name: string; version: string };
  if (packageJson.name !== pkg.name) {
    throw new Error(`${pkg.dir}/package.json has name ${packageJson.name}, expected ${pkg.name}`);
  }

  const source = readFileSync(join(root, pkg.versionFile), "utf8");
  const expectedLine = `export const ${pkg.constant} = "${packageJson.version}";`;
  if (!source.includes(expectedLine)) {
    throw new Error(`${pkg.versionFile} must contain ${expectedLine}`);
  }

  return packageJson.version;
});

const uniqueVersions = new Set(versions);
if (uniqueVersions.size !== 1) {
  throw new Error(`fdev package versions must match exactly: ${versions.join(", ")}`);
}

const version = versions[0]!;
const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith("v") && tag.slice(1) !== version) {
  throw new Error(`release tag ${tag} does not match package version ${version}`);
}

console.log(`fdev release version ${version}`);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
