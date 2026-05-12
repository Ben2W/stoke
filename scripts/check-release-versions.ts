import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packages = [
  {
    name: "@freestyle-sh/fdev-engine",
    dir: "packages/fdev-engine",
    versionFile: "packages/fdev-engine/src/version.ts",
    constant: "FDEV_ENGINE_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-runtime-client",
    dir: "packages/fdev-runtime-client",
    versionFile: "packages/fdev-runtime-client/src/version.ts",
    constant: "FDEV_RUNTIME_CLIENT_VERSION",
  },
  {
    name: "@freestyle-sh/fdev",
    dir: "packages/fdev",
    versionFile: "packages/fdev/src/version.ts",
    constant: "FDEV_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-provider-freestyle",
    dir: "packages/fdev-provider-freestyle",
    versionFile: "packages/fdev-provider-freestyle/src/version.ts",
    constant: "FDEV_PROVIDER_FREESTYLE_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-provider-gcloud",
    dir: "packages/fdev-provider-gcloud",
    versionFile: "packages/fdev-provider-gcloud/src/version.ts",
    constant: "FDEV_PROVIDER_GCLOUD_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-cmux",
    dir: "packages/fdev-cmux",
    versionFile: "packages/fdev-cmux/src/version.ts",
    constant: "FDEV_CMUX_VERSION",
  },
  {
    name: "@freestyle-sh/fdev-vscode",
    dir: "packages/fdev-vscode",
    versionFile: "packages/fdev-vscode/src/version.ts",
    constant: "FDEV_VSCODE_VERSION",
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

  if (pkg.name === "@freestyle-sh/fdev") {
    const runtimeVersionFile = "packages/fdev/src/runtime/version.ts";
    const runtimeSource = readFileSync(join(root, runtimeVersionFile), "utf8");
    const expectedRuntimeLine = `export const FDEV_RUNTIME_VERSION = "${packageJson.version}";`;
    if (!runtimeSource.includes(expectedRuntimeLine)) {
      throw new Error(`${runtimeVersionFile} must contain ${expectedRuntimeLine}`);
    }
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
