import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  bumpVersion,
  parseVersion,
  releaseLabels,
  releasePackages,
  root,
  sdkRuntimeVersion,
  sdkVersionExpectationFiles,
  type ReleaseLabel,
  type ReleasePackage,
  type ReleaseType,
  versionLineForVersion,
} from "./config";
import { syncPrepareReleaseWorkflowOptionsForVersion } from "./workflow-options";

export { bumpVersion };

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  allowFailure?: boolean;
  quiet?: boolean;
};

const decoder = new TextDecoder();

export function run(cmd: string[], options: RunOptions = {}): CommandResult {
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = decoder.decode(result.stdout).trim();
  const stderr = decoder.decode(result.stderr).trim();
  const exitCode = result.exitCode ?? 0;

  if (exitCode !== 0 && !options.allowFailure) {
    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(
      `Command failed (${exitCode}): ${cmd.join(" ")}${output ? `\n${output}` : ""}`,
    );
  }

  if (!options.quiet && stdout) {
    console.log(stdout);
  }

  return { stdout, stderr, exitCode };
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

export function readText(path: string) {
  return readFileSync(join(root, path), "utf8");
}

export function writeText(path: string, value: string) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value);
}

export type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: {
    access?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ReleaseState = {
  version: string;
  packageVersions: Map<string, string>;
};

export function getPackageJson(pkg: ReleasePackage) {
  return readJson<PackageJson>(join(pkg.dir, "package.json"));
}

export function readVersionConstant(path: string, constant: string) {
  const source = readText(path);
  const pattern = new RegExp(
    `export\\s+const\\s+${constant}\\s*=\\s*["']([^"']+)["']`,
  );
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`Could not find ${constant} in ${path}`);
  }

  return match[1];
}

export function replaceVersionConstant(
  path: string,
  constant: string,
  version: string,
) {
  const source = readText(path);
  const pattern = new RegExp(
    `(export\\s+const\\s+${constant}\\s*=\\s*)["'][^"']+["']`,
  );
  const next = source.replace(pattern, `$1"${version}"`);

  if (next === source) {
    throw new Error(`Could not replace ${constant} in ${path}`);
  }

  writeText(path, next);
}

export function getReleaseState(): ReleaseState {
  const packageVersions = new Map<string, string>();

  for (const pkg of releasePackages) {
    const packageJson = getPackageJson(pkg);

    if (!packageJson.version) {
      throw new Error(`${pkg.dir}/package.json is missing a version`);
    }

    packageVersions.set(pkg.name, packageJson.version);
  }

  const versions = new Set(packageVersions.values());
  if (versions.size !== 1) {
    throw new Error(
      `Release packages are not lockstep versioned: ${[...packageVersions.entries()]
        .map(([name, version]) => `${name}@${version}`)
        .join(", ")}`,
    );
  }

  return {
    version: [...versions][0],
    packageVersions,
  };
}

export function assertReleasePackageMetadata() {
  for (const pkg of releasePackages) {
    const packageJson = getPackageJson(pkg);
    if (packageJson.name !== pkg.name) {
      throw new Error(
        `${pkg.dir}/package.json has name ${packageJson.name}, expected ${pkg.name}`,
      );
    }

    if (packageJson.private) {
      throw new Error(`${pkg.name} is listed as a release package but is private`);
    }

    if (packageJson.publishConfig?.access !== "public") {
      throw new Error(`${pkg.name} must set publishConfig.access to public`);
    }
  }
}

export function assertNoUnconfiguredPublishablePackages() {
  const packagesDir = join(root, "packages");
  const configuredDirs = new Set(releasePackages.map((pkg) => pkg.dir));
  const publishableDirs: string[] = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join("packages", entry.name);
    const packageJsonPath = join(dir, "package.json");
    if (!existsSync(join(root, packageJsonPath))) {
      continue;
    }

    const packageJson = readJson<PackageJson>(packageJsonPath);
    if (!packageJson.private && packageJson.publishConfig?.access === "public") {
      publishableDirs.push(dir);
    }
  }

  const missing = publishableDirs.filter((dir) => !configuredDirs.has(dir));
  if (missing.length > 0) {
    throw new Error(
      `Publishable packages are missing from scripts/release/config.ts: ${missing.join(
        ", ",
      )}`,
    );
  }
}

export function assertVersionConstants(version: string) {
  for (const pkg of releasePackages) {
    const constantVersion = readVersionConstant(pkg.versionFile, pkg.versionConstant);
    if (constantVersion !== version) {
      throw new Error(
        `${pkg.versionFile} ${pkg.versionConstant} is ${constantVersion}, expected ${version}`,
      );
    }
  }

  const runtimeVersion = readVersionConstant(
    sdkRuntimeVersion.file,
    sdkRuntimeVersion.constant,
  );
  if (runtimeVersion !== version) {
    throw new Error(
      `${sdkRuntimeVersion.file} ${sdkRuntimeVersion.constant} is ${runtimeVersion}, expected ${version}`,
    );
  }
}

export function assertTagMatchesVersion(version: string, tag?: string) {
  if (!tag) {
    return;
  }

  const normalizedTag = tag.replace(/^refs\/tags\//, "");
  if (!normalizedTag.startsWith("v")) {
    throw new Error(`Release tag must start with v, got ${normalizedTag}`);
  }

  const tagVersion = normalizedTag.slice(1);
  if (tagVersion !== version) {
    throw new Error(
      `Release tag ${normalizedTag} does not match package version ${version}`,
    );
  }
}

export function runReleaseCheck(tag = process.env.GITHUB_REF_NAME) {
  const state = getReleaseState();

  parseVersion(state.version);
  assertReleasePackageMetadata();
  assertNoUnconfiguredPublishablePackages();
  assertVersionConstants(state.version);
  assertTagMatchesVersion(state.version, tag);
  syncPrepareReleaseWorkflowOptionsForVersion(state.version, { check: true });

  console.log(`Rigkit release version: ${state.version}`);
  return state;
}

export function cleanDirectory(path: string) {
  const absolute = join(root, path);
  rmSync(absolute, { recursive: true, force: true });
  mkdirSync(absolute, { recursive: true });
}

export function npmView(spec: string, field: string) {
  const result = run(
    ["npm", "view", spec, field, "--registry=https://registry.npmjs.org/"],
    {
      allowFailure: true,
      quiet: true,
    },
  );

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim() || undefined;
}

export function assertNpmPublishReady(options: {
  version: string;
  allowMissingPackageNames?: boolean;
  allowExistingVersion?: boolean;
}) {
  const missingPackageNames: string[] = [];
  const existingVersions: string[] = [];

  for (const pkg of releasePackages) {
    const publishedName = npmView(pkg.name, "name");
    if (!publishedName) {
      missingPackageNames.push(pkg.name);
      continue;
    }

    const publishedVersion = npmView(`${pkg.name}@${options.version}`, "version");
    if (publishedVersion) {
      existingVersions.push(`${pkg.name}@${publishedVersion}`);
    }
  }

  if (missingPackageNames.length > 0 && !options.allowMissingPackageNames) {
    throw new Error(
      [
        "Cannot publish because these npm package names are not bootstrapped:",
        ...missingPackageNames.map((name) => `- ${name}`),
        "Run the Bootstrap npm Packages workflow for a trusted tag first.",
      ].join("\n"),
    );
  }

  if (existingVersions.length > 0 && !options.allowExistingVersion) {
    throw new Error(
      `Cannot publish because these versions already exist on npm: ${existingVersions.join(
        ", ",
      )}`,
    );
  }
}

export function assertReleaseBranchForVersion(version: string) {
  const expectedBranch = `origin/release/${versionLineForVersion(version)}`;

  run(["git", "fetch", "origin", "+refs/heads/release/*:refs/remotes/origin/release/*"], {
    allowFailure: true,
    quiet: true,
  });

  const branches = run(["git", "branch", "-r", "--contains", "HEAD"], {
    allowFailure: true,
    quiet: true,
  }).stdout
    .split("\n")
    .map((line) => line.trim().replace(/^\*/, "").trim())
    .filter(Boolean);

  if (!branches.includes(expectedBranch)) {
    throw new Error(
      `Release commits must be reachable from ${expectedBranch}. Found: ${
        branches.join(", ") || "none"
      }`,
    );
  }
}

export function currentGitBranch() {
  return run(["git", "branch", "--show-current"], {
    allowFailure: true,
    quiet: true,
  }).stdout.trim();
}

export function assertCheckedOutReleaseBranch(version: string) {
  const branch = currentGitBranch();
  if (!branch.startsWith("release/")) {
    throw new Error(`Stable release preparation must run on release/*, got ${branch}`);
  }

  const expectedBranch = `release/${versionLineForVersion(version)}`;
  if (branch !== expectedBranch) {
    throw new Error(
      `Version ${version} belongs on ${expectedBranch}, but current branch is ${branch}`,
    );
  }
}

export function writeAllReleaseVersions(version: string) {
  for (const pkg of releasePackages) {
    const packageJsonPath = join(pkg.dir, "package.json");
    const packageJson = readJson<PackageJson>(packageJsonPath);
    packageJson.version = version;
    writeJson(packageJsonPath, packageJson);
    replaceVersionConstant(pkg.versionFile, pkg.versionConstant, version);
  }

  replaceVersionConstant(
    sdkRuntimeVersion.file,
    sdkRuntimeVersion.constant,
    version,
  );
}

export function replaceInFiles(paths: string[], current: string, next: string) {
  for (const path of paths) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      continue;
    }

    const source = readFileSync(absolute, "utf8");
    const updated = source.split(current).join(next);
    if (updated !== source) {
      writeFileSync(absolute, updated);
    }
  }
}

export function bumpAllReleaseVersions(nextVersion: string) {
  const currentVersion = getReleaseState().version;
  parseVersion(nextVersion);
  writeAllReleaseVersions(nextVersion);
  replaceInFiles(sdkVersionExpectationFiles, currentVersion, nextVersion);
  syncPrepareReleaseWorkflowOptionsForVersion(nextVersion);
  run(["pnpm", "install", "--lockfile-only"], { quiet: true });
  runReleaseCheck(undefined);
}

export function resolveBumpVersion(input: string, currentVersion: string) {
  if (input === "patch" || input === "minor" || input === "major") {
    return bumpVersion(currentVersion, input);
  }

  parseVersion(input);
  return input;
}

export function releaseLabelToType(label: ReleaseLabel): ReleaseType | undefined {
  if (label === "release:patch") {
    return "patch";
  }

  if (label === "release:minor") {
    return "minor";
  }

  if (label === "release:major") {
    return "major";
  }

  return undefined;
}

export function strongestReleaseType(labels: string[]): ReleaseType | undefined {
  const releaseTypeRank: Record<ReleaseType, number> = {
    patch: 1,
    minor: 2,
    major: 3,
  };
  let selected: ReleaseType | undefined;

  for (const label of labels) {
    if (!releaseLabels.includes(label as ReleaseLabel)) {
      continue;
    }

    const releaseType = releaseLabelToType(label as ReleaseLabel);
    if (!releaseType) {
      continue;
    }

    if (!selected || releaseTypeRank[releaseType] > releaseTypeRank[selected]) {
      selected = releaseType;
    }
  }

  return selected;
}

export function getPullRequestLabels(prNumber: string) {
  const result = run(
    ["gh", "pr", "view", prNumber, "--json", "labels", "--jq", ".labels[].name"],
    { quiet: true },
  );

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function getMergedPullRequestNumbersSinceLastTag() {
  const lastTag = run(["git", "describe", "--tags", "--match", "v*", "--abbrev=0"], {
    allowFailure: true,
    quiet: true,
  }).stdout.trim();

  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const log = run(["git", "log", range, "--pretty=%s"], { quiet: true }).stdout;
  const numbers = new Set<string>();

  for (const line of log.split("\n")) {
    for (const match of line.matchAll(/#(\d+)/g)) {
      numbers.add(match[1]);
    }
  }

  return [...numbers];
}
