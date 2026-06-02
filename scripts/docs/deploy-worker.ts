import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root, versionLineForVersion } from "../release/config";

const docsDir = join(root, "apps", "docs");
const decoder = new TextDecoder();

type DeployTarget = {
  workerName: string;
  basePath: string;
  cacheVersionSuffix: string;
};

const args = process.argv.slice(2);
const version = valueArg("--version") ?? positionalVersion();
const dryRun = hasArg("--dry-run");
const skipBuild = hasArg("--skip-build");
const outdir = valueArg("--outdir");
const target = version ? targetForVersion(version) : latestTarget();

if (!skipBuild) {
  run(["pnpm", "--filter", "@rigkit/docs", "build"], {
    env: {
      RIGKIT_DOCS_BASE_PATH: target.basePath,
      PUBLIC_DOCS_BASE_PATH: target.basePath,
    },
  });
}

const configPath = join(docsDir, `wrangler.${target.workerName}.generated.jsonc`);
writeFileSync(configPath, `${JSON.stringify(wranglerConfigFor(target), null, 2)}\n`);

try {
  const cacheVersion = run(["bun", "scripts/cache-version.ts"], { cwd: docsDir }).stdout.trim();
  const deployArgs = [
    "wrangler",
    "deploy",
    "--config",
    configPath,
    "--var",
    `CACHE_VERSION:${cacheVersion}-${target.cacheVersionSuffix}`,
  ];

  if (dryRun) deployArgs.push("--dry-run");
  if (outdir) deployArgs.push("--outdir", outdir);

  run(deployArgs, { cwd: docsDir });
} finally {
  rmSync(configPath, { force: true });
}

function latestTarget(): DeployTarget {
  return {
    workerName: "rigkit-docs",
    basePath: "/docs",
    cacheVersionSuffix: "latest",
  };
}

function targetForVersion(rawVersion: string): DeployTarget {
  const normalized = rawVersion.trim().replace(/^v/, "");
  const line = versionLineForVersion(normalized);
  const archiveVersion = `v${line}`;
  return {
    workerName: `rigkit-docs-${archiveVersion.replace(/\./g, "-")}`,
    basePath: `/docs/${archiveVersion}`,
    cacheVersionSuffix: archiveVersion.replace(/\./g, "-"),
  };
}

function wranglerConfigFor(target: DeployTarget) {
  return {
    "$schema": "./node_modules/wrangler/config-schema.json",
    name: target.workerName,
    main: "./src/worker-app.ts",
    compatibility_date: "2026-05-25",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: true,
    vars: {
      CACHE_VERSION: "docs-dev",
    },
    assets: {
      directory: "./dist/docs/client",
      binding: "ASSETS",
      run_worker_first: true,
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
    },
    routes: [],
  };
}

function run(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = decoder.decode(result.stdout);
  const stderr = decoder.decode(result.stderr);
  const exitCode = result.exitCode ?? 0;

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${cmd.join(" ")}${stdout ? `\n${stdout.trim()}` : ""}${stderr ? `\n${stderr.trim()}` : ""}`,
    );
  }

  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());

  return { stdout, stderr, exitCode };
}

function valueArg(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasArg(name: string): boolean {
  return args.includes(name);
}

function positionalVersion() {
  return args.find((arg) => arg !== "--" && !arg.startsWith("--"));
}
