#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Command } from "commander";
import {
  createDevMachineEngine,
  type DevMachineEngine,
  type DevMachineEvent,
  type MachinePlan,
  type SnapshotRecord,
  type WorkspaceRecord,
} from "@freestyle/fdev-engine";
import { assertVersionAlignment, DEFAULT_CONFIG_FILE, resolveConfigPaths, SDK_PACKAGE_NAME } from "./project.ts";
import { FDEV_CLI_VERSION } from "./version.ts";

type GlobalOptions = {
  project?: string;
  config?: string;
  json?: boolean;
};

type InitOptions = GlobalOptions & {
  force?: boolean;
};

type ApplyOptions = GlobalOptions & {
  dryRun?: boolean;
};

type ForkOptions = GlobalOptions & {
  name?: string;
};

type SshOptions = GlobalOptions & {
  print?: boolean;
  user?: string;
};

type SnapshotOptions = GlobalOptions & {
  label?: string;
};

type RemoveOptions = GlobalOptions & {
  yes?: boolean;
};

const program = new Command();

program
  .name("fdev")
  .description("Freestyle dev machine CLI")
  .version(FDEV_CLI_VERSION)
  .showHelpAfterError()
  .option("-C, --project <dir>", `Project directory containing ${DEFAULT_CONFIG_FILE}`)
  .option("--config <file>", "Exact config file to load")
  .option("--json", "Print machine-readable JSON where supported");

program
  .command("init")
  .description(`Create a starter ${DEFAULT_CONFIG_FILE}`)
  .option("--force", "Overwrite an existing config file")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command) {
    await runInit(this, this.optsWithGlobals() as InitOptions);
  });

program
  .command("plan")
  .description("Show cached and pending migrations")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command) {
    const engine = await loadEngine(this);
    const plan = await engine.plan();
    if (wantsJson(this)) {
      printJson(plan);
      return;
    }
    printPlan(plan);
  });

program
  .command("apply")
  .description("Resolve the dev machine, running pending migrations")
  .option("--dry-run", "Show the plan without running migrations")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command) {
    const options = this.optsWithGlobals() as ApplyOptions;
    const engine = await loadEngine(this);

    if (options.dryRun) {
      const plan = await engine.plan();
      if (wantsJson(this)) {
        printJson({ dryRun: true, plan });
        return;
      }
      printPlan(plan);
      console.log("No changes applied.");
      return;
    }

    const result = await engine.apply();
    if (wantsJson(this)) {
      printJson(result);
      return;
    }
    const vmSuffix = result.vmId ? ` (${result.vmId})` : "";
    console.log(`resolved ${result.plan.machine} -> ${result.snapshotId ?? "no snapshot"}${vmSuffix}`);
  });

program
  .command("fork")
  .description("Create a workspace VM from the resolved dev machine snapshot")
  .requiredOption("--name <workspace>", "Workspace name")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command) {
    const options = this.optsWithGlobals() as ForkOptions;
    const engine = await loadEngine(this);
    const workspace = await engine.fork({ name: options.name ?? "" });
    if (wantsJson(this)) {
      printJson(workspace);
      return;
    }
    console.log(`${workspace.name} ${workspace.vmId}`);
  });

program
  .command("ls [target]")
  .alias("list")
  .description("List workspaces, snapshots, or config")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command, target?: string) {
    const engine = await loadEngine(this);
    const kind = normalizeListTarget(target);

    if (kind === "workspaces") {
      const workspaces = engine.listWorkspaces();
      if (wantsJson(this)) {
        printJson(workspaces);
        return;
      }
      printWorkspaces(workspaces);
      return;
    }

    if (kind === "snapshots") {
      const snapshots = engine.listSnapshots();
      if (wantsJson(this)) {
        printJson(snapshots);
        return;
      }
      printSnapshots(snapshots);
      return;
    }

    const info = engine.getProjectInfo();
    if (wantsJson(this)) {
      printJson(info);
      return;
    }
    printConfig(info);
  });

program
  .command("ssh <workspace-or-vm-id>")
  .alias("terminal")
  .description("Open SSH to a workspace or VM")
  .option("--print", "Print the SSH command instead of executing it")
  .option("--user <user>", "SSH user to allow")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command, workspaceOrVmId: string) {
    const options = this.optsWithGlobals() as SshOptions;
    const engine = await loadEngine(this);
    const terminal = await engine.attachTerminal({
      workspaceOrVmId,
      printOnly: Boolean(options.print || wantsJson(this)),
      user: options.user,
    });

    if (wantsJson(this)) {
      printJson(terminal);
      return;
    }

    if (options.print) console.log(terminal.command);
  });

program
  .command("snapshot <workspace>")
  .description("Capture a snapshot from a workspace VM")
  .option("--label <label>", "Human-readable snapshot label")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command, workspace: string) {
    const options = this.optsWithGlobals() as SnapshotOptions;
    const engine = await loadEngine(this);
    const snapshot = await engine.snapshotWorkspace({ workspace, label: options.label });
    if (wantsJson(this)) {
      printJson(snapshot);
      return;
    }
    console.log(snapshot.snapshotId);
  });

program
  .command("rm <workspace>")
  .description("Delete a workspace VM and remove it from local state")
  .option("-y, --yes", "Confirm deletion")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command, workspace: string) {
    const options = this.optsWithGlobals() as RemoveOptions;
    if (!options.yes) {
      throw new Error(`Refusing to delete ${workspace} without --yes`);
    }

    const engine = await loadEngine(this);
    const removed = await engine.deleteWorkspace({ workspace });
    if (wantsJson(this)) {
      printJson({ removed });
      return;
    }
    console.log(`removed ${removed.name} ${removed.vmId}`);
  });

if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function runInit(command: Command, options: InitOptions): Promise<void> {
  const paths = resolveCommandConfigPaths(command);
  mkdirSync(dirname(paths.configPath), { recursive: true });

  if (existsSync(paths.configPath) && !options.force) {
    throw new Error(`${paths.configPath} already exists. Pass --force to overwrite it.`);
  }

  const wroteConfig = !existsSync(paths.configPath) || Boolean(options.force);
  if (wroteConfig) {
    writeFileSync(paths.configPath, starterConfig());
  }

  const envExamplePath = join(dirname(paths.configPath), ".env.example");
  const wroteEnvExample = !existsSync(envExamplePath);
  if (wroteEnvExample) {
    writeFileSync(envExamplePath, "FREESTYLE_API_KEY=\n");
  }

  const packageJson = ensureProjectPackageJson(paths.projectDir);

  const result = {
    configPath: paths.configPath,
    envExamplePath,
    packageJsonPath: packageJson.path,
    created: {
      config: wroteConfig,
      envExample: wroteEnvExample,
      packageJson: packageJson.created,
    },
    updated: {
      sdkDependency: packageJson.sdkDependencyChanged,
    },
  };

  if (wantsJson(command)) {
    printJson(result);
    return;
  }

  console.log(`created ${paths.configPath}`);
  if (wroteEnvExample) console.log(`created ${envExamplePath}`);
  if (packageJson.created) console.log(`created ${packageJson.path}`);
  if (packageJson.sdkDependencyChanged) {
    console.log(`pinned ${SDK_PACKAGE_NAME}@${FDEV_CLI_VERSION}`);
  }
}

async function loadEngine(command: Command): Promise<DevMachineEngine> {
  const engineOptions = resolveEngineOptions(command);
  assertVersionAlignment(engineOptions.projectDir);
  const engine = await createDevMachineEngine(engineOptions);
  if (!wantsJson(command)) engine.onEvent(renderEvent);
  await engine.load();
  return engine;
}

function resolveEngineOptions(command: Command): { projectDir: string; configPath?: string } {
  const paths = resolveCommandConfigPaths(command);
  const options = command.optsWithGlobals() as GlobalOptions;
  if (options.config) return { projectDir: paths.projectDir, configPath: paths.configPath };
  return { projectDir: paths.projectDir };
}

function resolveCommandConfigPaths(command: Command): { projectDir: string; configPath: string } {
  const options = command.optsWithGlobals() as GlobalOptions;
  return resolveConfigPaths({ project: options.project, config: options.config });
}

function wantsJson(command: Command): boolean {
  return Boolean((command.optsWithGlobals() as GlobalOptions).json);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printPlan(plan: MachinePlan): void {
  console.log(`${plan.machine}: ${plan.cachedPrefixLength}/${plan.migrations.length} migrations cached`);
  if (plan.cachedSnapshotId) console.log(`snapshot: ${plan.cachedSnapshotId}`);

  const rows = plan.migrations.map((migration) => [
    String(migration.index + 1),
    migration.status,
    migration.name,
  ]);
  printTable(["#", "status", "migration"], rows);
}

function printWorkspaces(workspaces: WorkspaceRecord[]): void {
  if (workspaces.length === 0) {
    console.log("No workspaces.");
    return;
  }

  printTable(
    ["name", "vm", "snapshot", "machine", "created"],
    workspaces.map((workspace) => [
      workspace.name,
      workspace.vmId,
      workspace.snapshotId,
      workspace.machine,
      workspace.createdAt,
    ]),
  );
}

function printSnapshots(snapshots: SnapshotRecord[]): void {
  if (snapshots.length === 0) {
    console.log("No snapshots.");
    return;
  }

  printTable(
    ["snapshot", "machine", "prefix", "migration", "created"],
    snapshots.map((snapshot) => [
      snapshot.snapshotId,
      snapshot.machine,
      String(snapshot.prefixLength),
      snapshot.migrationName,
      snapshot.createdAt,
    ]),
  );
}

function printConfig(info: ReturnType<DevMachineEngine["getProjectInfo"]>): void {
  const rows = [
    ["config", info.configPath],
    ["project", info.projectDir],
    ["state", info.statePath],
    ["machine", info.machine?.name ?? "(not loaded)"],
    ["image", info.machine?.image ?? ""],
  ];
  printTable(["key", "value"], rows);
}

function normalizeListTarget(target: string | undefined): "workspaces" | "snapshots" | "config" {
  if (!target || target === "workspaces" || target === "workspace" || target === "vms" || target === "vm") {
    return "workspaces";
  }
  if (target === "snapshots" || target === "snapshot") return "snapshots";
  if (target === "config" || target === "machine" || target === "machines") return "config";
  throw new Error(`Unknown ls target ${target}. Expected workspaces, snapshots, or config.`);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)),
  );
  const format = (row: string[]) =>
    row.map((value, index) => String(value ?? "").padEnd(widths[index] ?? 0)).join("  ").trimEnd();

  console.log(format(headers));
  console.log(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(format(row));
}

function renderEvent(event: DevMachineEvent): void {
  switch (event.type) {
    case "definition.loaded":
      console.error(`loaded ${event.machine}`);
      return;
    case "plan.created":
      console.error(`plan ${event.machine}: ${event.cachedPrefixLength}/${event.migrationCount} cached`);
      return;
    case "vm.created":
      console.error(event.fromSnapshotId ? `vm ${event.vmId} from ${event.fromSnapshotId}` : `vm ${event.vmId} created`);
      return;
    case "migration.started":
      console.error(`migration ${event.migration}`);
      return;
    case "step.started":
      console.error(`step ${event.step}`);
      return;
    case "step.output":
      process.stderr.write(event.data);
      return;
    case "step.completed":
      console.error(`step ${event.step} exited ${event.exitCode}`);
      return;
    case "interaction.awaiting_user":
      console.error(`interaction ${event.label}`);
      return;
    case "snapshot.created":
      console.error(`snapshot ${event.snapshotId}`);
      return;
    case "workspace.ready":
      console.error(`workspace ${event.workspaceId} -> ${event.vmId}`);
      return;
    default:
      return;
  }
}

function starterConfig(): string {
  return `import { defineDevMachine, defineMigration, env } from "@freestyle/fdev-sdk";

const verifyNode = defineMigration("verify node 22", async ({ step }) => {
  await step.assert("node is v22", async ({ vm }) => {
    const result = await vm.exec("node --version");
    return result.ok && result.stdout.trim().startsWith("v22.");
  });
});

export default defineDevMachine({
  name: "dev",
  apiKey: () => env("FREESTYLE_API_KEY"),
  image: "node-22",
  migrations: [verifyNode],
});
`;
}

function ensureProjectPackageJson(projectDir: string): { path: string; created: boolean; sdkDependencyChanged: boolean } {
  const path = join(projectDir, "package.json");
  const created = !existsSync(path);
  const pkg = created
    ? {
        name: packageNameFromDir(projectDir),
        private: true,
        type: "module",
        scripts: {
          plan: "fdev plan",
          apply: "fdev apply",
        },
      }
    : JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

  const devDependencies = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  const sdkDependencyChanged = devDependencies[SDK_PACKAGE_NAME] !== FDEV_CLI_VERSION;
  devDependencies[SDK_PACKAGE_NAME] = FDEV_CLI_VERSION;
  pkg.devDependencies = sortObject(devDependencies);

  if (created || sdkDependencyChanged) {
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return { path, created, sdkDependencyChanged };
}

function packageNameFromDir(projectDir: string): string {
  return basename(projectDir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "fdev-project";
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sortObject<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
