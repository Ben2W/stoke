#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { createDevMachineEngine, type DevMachineEngine } from "./engine.ts";
import type { SnapshotRecord } from "./state.ts";
import type { DevMachineEvent, MachinePlan, WorkspaceRecord } from "./types.ts";

const DEFAULT_CONFIG_FILE = "fdev.config.ts";

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

type GcOptions = GlobalOptions & {
  yes?: boolean;
  dryRun?: boolean;
};

const program = new Command();

program
  .name("fdev")
  .description("Freestyle dev machine CLI")
  .version("0.0.0")
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

program
  .command("gc")
  .description("Clean stale local cache entries for old machine chains")
  .option("--dry-run", "Show what would be removed")
  .option("-y, --yes", "Remove stale entries")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command) {
    const options = this.optsWithGlobals() as GcOptions;
    const dryRun = Boolean(options.dryRun || !options.yes);
    const engine = await loadEngine(this);
    const result = await engine.gc({ dryRun });
    if (wantsJson(this)) {
      printJson(result);
      return;
    }
    printGc(result);
  });

if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function runInit(command: Command, options: InitOptions): Promise<void> {
  const paths = resolveConfigPaths(command);
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

  const result = {
    configPath: paths.configPath,
    envExamplePath,
    created: {
      config: wroteConfig,
      envExample: wroteEnvExample,
    },
  };

  if (wantsJson(command)) {
    printJson(result);
    return;
  }

  console.log(`created ${paths.configPath}`);
  if (wroteEnvExample) console.log(`created ${envExamplePath}`);
}

async function loadEngine(command: Command): Promise<DevMachineEngine> {
  const engine = await createDevMachineEngine(resolveEngineOptions(command));
  if (!wantsJson(command)) engine.onEvent(renderEvent);
  await engine.load();
  return engine;
}

function resolveEngineOptions(command: Command): { projectDir?: string; configPath?: string } {
  const paths = resolveConfigPaths(command);
  const options = command.optsWithGlobals() as GlobalOptions;
  if (options.config) return { configPath: paths.configPath };
  return { projectDir: paths.projectDir };
}

function resolveConfigPaths(command: Command): { projectDir: string; configPath: string } {
  const options = command.optsWithGlobals() as GlobalOptions;
  const projectDir = resolve(options.project ?? process.cwd());
  const configPath = options.config ? resolve(projectDir, options.config) : join(projectDir, DEFAULT_CONFIG_FILE);
  return { projectDir: dirname(configPath), configPath };
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

function printGc(result: {
  staleSnapshots: SnapshotRecord[];
  staleWorkspaces: WorkspaceRecord[];
  removedSnapshots: number;
  removedWorkspaces: number;
  dryRun: boolean;
}): void {
  const action = result.dryRun ? "would remove" : "removed";
  console.log(`${action} ${result.dryRun ? result.staleSnapshots.length : result.removedSnapshots} stale snapshots`);
  console.log(`${action} ${result.dryRun ? result.staleWorkspaces.length : result.removedWorkspaces} stale workspaces`);
  if (result.dryRun && (result.staleSnapshots.length > 0 || result.staleWorkspaces.length > 0)) {
    console.log("Pass --yes to remove these local cache entries.");
  }
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
  return `import { defineDevMachine, defineMigration, env } from "@freestyle/fdev";

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
