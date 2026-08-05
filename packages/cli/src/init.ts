import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DEFAULT_CONFIG_PATH } from "./project.ts";

export const STOKE_INIT_DEV_DEPENDENCIES = {
  "@usestoke/provider-vercel-sandbox": "0.1.6",
  "@usestoke/sdk": "0.1.5",
} as const;

export type InitProjectInput = {
  projectDir: string;
};

export type InitProjectResult = {
  name: string;
  projectDir: string;
  configPath: string;
  packageJsonPath: string;
  created: { config: boolean; packageJson: boolean };
  updated: { packageJson: boolean };
};

export function initProject(input: InitProjectInput): InitProjectResult {
  const configPath = join(input.projectDir, DEFAULT_CONFIG_PATH);
  mkdirSync(input.projectDir, { recursive: true });
  mkdirSync(dirname(configPath), { recursive: true });

  if (existsSync(configPath)) throw new Error(`${configPath} already exists.`);

  writeFileSync(configPath, starterConfig());
  const packageJson = ensureProjectPackageJson(input.projectDir);

  return {
    name: packageJson.name,
    projectDir: input.projectDir,
    configPath,
    packageJsonPath: packageJson.path,
    created: { config: true, packageJson: packageJson.created },
    updated: { packageJson: packageJson.updated },
  };
}

function ensureProjectPackageJson(projectDir: string): {
  name: string;
  path: string;
  created: boolean;
  updated: boolean;
} {
  const path = join(projectDir, "package.json");
  const created = !existsSync(path);
  const pkg = created
    ? { name: defaultPackageName(projectDir), private: true, type: "module" }
    : JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const name = typeof pkg.name === "string" && pkg.name.trim()
    ? pkg.name.trim()
    : defaultPackageName(projectDir);

  let changed = false;
  for (const [key, value] of Object.entries({ name, private: true, type: "module" })) {
    if (pkg[key] !== value) {
      pkg[key] = value;
      changed = true;
    }
  }

  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  for (const [key, value] of Object.entries({ apply: "stoke apply", plan: "stoke plan" })) {
    if (scripts[key] !== value) {
      scripts[key] = value;
      changed = true;
    }
  }
  pkg.scripts = sortObject(scripts);

  for (const [dependency, version] of Object.entries(stokeDevDependencies())) {
    changed = upsertProjectDependency(pkg, dependency, version) || changed;
  }

  if (created || changed) writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  return { name, path, created, updated: !created && changed };
}

function upsertProjectDependency(
  pkg: Record<string, unknown>,
  name: string,
  version: string,
): boolean {
  const dependencies = isRecord(pkg.dependencies) ? pkg.dependencies : undefined;
  if (dependencies && Object.prototype.hasOwnProperty.call(dependencies, name)) {
    if (dependencies[name] === version) return false;
    dependencies[name] = version;
    pkg.dependencies = sortObject(dependencies);
    return true;
  }

  const devDependencies = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  if (devDependencies[name] === version) return false;
  devDependencies[name] = version;
  pkg.devDependencies = sortObject(devDependencies);
  return true;
}

function stokeDevDependencies(): Record<string, string> {
  return STOKE_INIT_DEV_DEPENDENCIES;
}

function defaultPackageName(projectDir: string): string {
  const name = basename(projectDir) || "stoke-project";
  return normalizePackageName(name);
}

function normalizePackageName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return name || "stoke-project";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sortObject<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function starterConfig(): string {
  return `import { workflow } from "@usestoke/sdk";
import { vercelSandbox } from "@usestoke/provider-vercel-sandbox";

const sandbox = vercelSandbox.provider();
const terminal = vercelSandbox.terminal();

export const dev = workflow("dev")
  .sequence("dev")
  .addProvider("vercel", sandbox)
  .workspace({
    create: async ({ providers }) => {
      const environment = await providers.vercel.client.create({
        runtime: "node24",
        timeout: 60 * 60 * 1000,
      });
      return { sandbox: environment.name };
    },
    remove: async ({ providers, workspace }) => {
      await providers.vercel.ref(workspace.ctx.sandbox).stop();
    },
  })
  .addProvider("terminal", terminal)
  .workspaceOperation("ssh", {
    title: "SSH",
    description: "Open an interactive Vercel Sandbox terminal",
    run: async ({ providers, workspace }) => {
      await providers.terminal.open({
        sandbox: workspace.ctx.sandbox,
        title: "SSH " + workspace.name,
      });
    },
  });
`;
}
