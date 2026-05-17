import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RIGKIT_CLI_VERSION } from "./version.ts";
import {
  FREESTYLE_PROVIDER_PACKAGE_NAME,
  FREESTYLE_SDK_PACKAGE_NAME,
  FREESTYLE_SDK_PACKAGE_VERSION,
  PROJECT_PACKAGE_NAME,
} from "./project.ts";

export type InitProjectInput = {
  projectDir: string;
  configPath: string;
  name: string;
  apiKey?: string;
  force?: boolean;
};

export type InitProjectResult = {
  name: string;
  projectDir: string;
  configPath: string;
  envPath: string;
  envExamplePath: string;
  gitignorePath: string;
  packageJsonPath: string;
  created: {
    config: boolean;
    env: boolean;
    envExample: boolean;
    packageJson: boolean;
    gitignore: boolean;
  };
  updated: {
    envApiKey: boolean;
    gitignore: boolean;
    packageJson: boolean;
    sdkDependency: boolean;
  };
};

export function initProject(input: InitProjectInput): InitProjectResult {
  const name = normalizeMachineName(input.name);
  mkdirSync(input.projectDir, { recursive: true });

  if (existsSync(input.configPath) && !input.force) {
    throw new Error(`${input.configPath} already exists. Pass --force to overwrite it.`);
  }

  const wroteConfig = !existsSync(input.configPath) || Boolean(input.force);
  if (wroteConfig) {
    writeFileSync(input.configPath, starterConfig(name));
  }

  const apiKey = input.apiKey?.trim();
  const envPath = join(input.projectDir, ".env");
  const env = apiKey
    ? writeEnvFile(envPath, apiKey)
    : { created: false, updated: false };

  const envExamplePath = join(input.projectDir, ".env.example");
  const wroteEnvExample = Boolean(apiKey) && !existsSync(envExamplePath);
  if (wroteEnvExample) {
    writeFileSync(envExamplePath, "FREESTYLE_API_KEY=\n");
  }

  const gitignore = ensureGitignore(input.projectDir);
  const packageJson = ensureProjectPackageJson(input.projectDir, name);

  return {
    name,
    projectDir: input.projectDir,
    configPath: input.configPath,
    envPath,
    envExamplePath,
    gitignorePath: gitignore.path,
    packageJsonPath: packageJson.path,
    created: {
      config: wroteConfig,
      env: env.created,
      envExample: wroteEnvExample,
      gitignore: gitignore.created,
      packageJson: packageJson.created,
    },
    updated: {
      envApiKey: env.updated,
      gitignore: gitignore.updated,
      packageJson: packageJson.updated,
      sdkDependency: packageJson.sdkDependencyChanged,
    },
  };
}

export function normalizeMachineName(value: string): string {
  const name = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) {
    throw new Error("Project name is required.");
  }
  return name;
}

export function starterConfig(name: string): string {
  const workflowName = JSON.stringify(normalizeMachineName(name));

  return `import { defineConfig, sequence } from "@rigkit/sdk";
import { freestyle, VmBaseImage, VmSpec } from "@rigkit/provider-freestyle";

const vmIdleTimeoutSeconds = 3600;
const vmSpec = new VmSpec()
  .baseImage(new VmBaseImage("FROM node:22"))
  .idleTimeoutSeconds(vmIdleTimeoutSeconds);

const freestyleProvider = freestyle.provider();

const dev = sequence(${workflowName})
  .step("verify-node-22", async ({ providers }) => {
    console.log("creating verification vm");
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      spec: vmSpec,
      logger: console.log,
    });
    try {
      const result = await vm.exec("node --version");
      if ((result.statusCode ?? 0) !== 0 || !result.stdout.trim().startsWith("v22.")) {
        throw new Error(\`Expected Node.js v22, got: \${result.stdout}\${result.stderr}\`);
      }
      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .workspace({
    create: async ({ workflow, providers }) => {
      console.log("booting workspace vm");
      const { vmId } = await providers.freestyle.client.vms.create({
        snapshotId: workflow.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: console.log,
      });
      return {
        vmId,
      };
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.client.vms.delete({ vmId: workspace.ctx.vmId });
    },
  });

export default defineConfig({
  providers: {
    freestyle: freestyleProvider,
  },
  workflows: {
    dev,
  },
});
`;
}

function writeEnvFile(path: string, apiKey: string): { created: boolean; updated: boolean } {
  const created = !existsSync(path);
  const existing = created ? "" : readFileSync(path, "utf8");
  const lines = existing ? existing.split(/\r?\n/) : [];
  const nextLine = `FREESTYLE_API_KEY=${apiKey}`;
  let found = false;
  let updated = created;

  const next = lines.map((line) => {
    if (!line.startsWith("FREESTYLE_API_KEY=")) return line;
    found = true;
    if (line === nextLine) return line;
    updated = true;
    return nextLine;
  });

  if (!found) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(nextLine);
    updated = true;
  }

  if (updated) {
    writeFileSync(path, `${next.join("\n").replace(/\n+$/, "")}\n`);
  }

  return { created, updated };
}

function ensureGitignore(projectDir: string): { path: string; created: boolean; updated: boolean } {
  const path = join(projectDir, ".gitignore");
  const created = !existsSync(path);
  const existing = created ? "" : readFileSync(path, "utf8");
  const entries = existing.split(/\r?\n/).filter(Boolean);
  let updated = false;

  for (const entry of [".env", ".rigkit/"]) {
    if (!entries.includes(entry)) {
      entries.push(entry);
      updated = true;
    }
  }

  if (created || updated) {
    writeFileSync(path, `${entries.join("\n")}\n`);
  }

  return { path, created, updated: created || updated };
}

function ensureProjectPackageJson(
  projectDir: string,
  name: string,
): { path: string; created: boolean; updated: boolean; sdkDependencyChanged: boolean } {
  const path = join(projectDir, "package.json");
  const created = !existsSync(path);
  const pkg = created
    ? {
        name,
        private: true,
        type: "module",
        scripts: {},
      }
    : JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

  let updated = created;

  if (!isRecord(pkg.scripts)) {
    pkg.scripts = {};
    updated = true;
  }

  const scripts = pkg.scripts as Record<string, string>;
  for (const [key, value] of Object.entries({ plan: "rig plan", apply: "rig apply" })) {
    if (scripts[key] !== value) {
      scripts[key] = value;
      updated = true;
    }
  }
  pkg.scripts = sortObject(scripts);

  const devDependencies = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  const sdkDependencyChanged =
    devDependencies[PROJECT_PACKAGE_NAME] !== RIGKIT_CLI_VERSION ||
    devDependencies[FREESTYLE_PROVIDER_PACKAGE_NAME] !== RIGKIT_CLI_VERSION ||
    devDependencies[FREESTYLE_SDK_PACKAGE_NAME] !== FREESTYLE_SDK_PACKAGE_VERSION;
  if (sdkDependencyChanged) {
    delete devDependencies["@rigkit/runtime"];
    devDependencies[PROJECT_PACKAGE_NAME] = RIGKIT_CLI_VERSION;
    devDependencies[FREESTYLE_PROVIDER_PACKAGE_NAME] = RIGKIT_CLI_VERSION;
    devDependencies[FREESTYLE_SDK_PACKAGE_NAME] = FREESTYLE_SDK_PACKAGE_VERSION;
    updated = true;
  }
  pkg.devDependencies = sortObject(devDependencies);

  if (created || updated) {
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return { path, created, updated, sdkDependencyChanged };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sortObject<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
