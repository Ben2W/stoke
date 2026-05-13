import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packages = [
  {
    name: "@rigkit/engine",
    dir: "packages/engine",
    versionFile: "packages/engine/src/version.ts",
    constant: "RIGKIT_ENGINE_VERSION",
  },
  {
    name: "@rigkit/runtime-client",
    dir: "packages/runtime-client",
    versionFile: "packages/runtime-client/src/version.ts",
    constant: "RIGKIT_RUNTIME_CLIENT_VERSION",
  },
  {
    name: "@rigkit/sdk",
    dir: "packages/sdk",
    versionFile: "packages/sdk/src/version.ts",
    constant: "RIGKIT_SDK_VERSION",
  },
  {
    name: "@rigkit/provider-freestyle",
    dir: "packages/provider-freestyle",
    versionFile: "packages/provider-freestyle/src/version.ts",
    constant: "RIGKIT_PROVIDER_FREESTYLE_VERSION",
  },
  {
    name: "@rigkit/provider-gcloud-cli",
    dir: "packages/provider-gcloud-cli",
    versionFile: "packages/provider-gcloud-cli/src/version.ts",
    constant: "RIGKIT_PROVIDER_GCLOUD_CLI_VERSION",
  },
  {
    name: "@rigkit/provider-cmux",
    dir: "packages/provider-cmux",
    versionFile: "packages/provider-cmux/src/version.ts",
    constant: "RIGKIT_PROVIDER_CMUX_VERSION",
  },
  {
    name: "@rigkit/provider-vscode",
    dir: "packages/provider-vscode",
    versionFile: "packages/provider-vscode/src/version.ts",
    constant: "RIGKIT_PROVIDER_VSCODE_VERSION",
  },
  {
    name: "@rigkit/cli",
    dir: "packages/cli",
    versionFile: "packages/cli/src/version.ts",
    constant: "RIGKIT_CLI_VERSION",
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

  if (pkg.name === "@rigkit/sdk") {
    const runtimeVersionFile = "packages/sdk/src/runtime/version.ts";
    const runtimeSource = readFileSync(join(root, runtimeVersionFile), "utf8");
    const expectedRuntimeLine = `export const RIGKIT_RUNTIME_VERSION = "${packageJson.version}";`;
    if (!runtimeSource.includes(expectedRuntimeLine)) {
      throw new Error(`${runtimeVersionFile} must contain ${expectedRuntimeLine}`);
    }
  }

  return packageJson.version;
});

const uniqueVersions = new Set(versions);
if (uniqueVersions.size !== 1) {
  throw new Error(`Rigkit package versions must match exactly: ${versions.join(", ")}`);
}

const version = versions[0]!;
const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith("v") && tag.slice(1) !== version) {
  throw new Error(`release tag ${tag} does not match package version ${version}`);
}

console.log(`rigkit release version ${version}`);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
