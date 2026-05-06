#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { Command } from "commander";
import {
  createDevMachineEngine,
  type DevMachineEngine,
  type DevMachineEvent,
  type MachinePlan,
  type SnapshotRecord,
  type WorkspaceRecord,
} from "@freestyle-sh/fdev-engine";
import { assertVersionAlignment, DEFAULT_CONFIG_FILE, resolveConfigPaths, SDK_PACKAGE_NAME } from "./project.ts";
import { FDEV_CLI_VERSION } from "./version.ts";
import { initProject, normalizeMachineName, type InitProjectResult } from "./init.ts";
import { createLocalTerminalInteraction } from "./interaction.ts";
import {
  completeFdev,
  formatCompletionItems,
  renderCompletionScript,
  resolveCompletionShell,
  type CompletionShell,
} from "./completion.ts";

type GlobalOptions = {
  project?: string;
  config?: string;
  json?: boolean;
};

type InitOptions = GlobalOptions & {
  force?: boolean;
  name?: string;
  apiKey?: string;
  packageManager?: PackageManager;
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

type CompletionOptions = {
  shell?: CompletionShell;
  index?: string;
};

type PackageManager = "npm" | "bun" | "pnpm" | "skip";

type InitInstallResult = {
  packageManager: PackageManager;
  command?: string;
  skipped: boolean;
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
  .description("Initialize an fdev project")
  .option("--name <name>", "Project and dev machine name")
  .option("--api-key <key>", "Freestyle API key")
  .option("--package-manager <manager>", "Install with npm, bun, pnpm, or skip", parsePackageManager)
  .option("--force", "Overwrite an existing config file")
  .option("--json", "Print machine-readable JSON")
  .action(async function (this: Command) {
    await runInit(this, this.optsWithGlobals() as InitOptions);
  });

program
  .command("plan")
  .description("Show cached and pending steps")
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
  .description("Resolve the dev machine, running pending steps")
  .option("--dry-run", "Show the plan without running steps")
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
    if (result.snapshotId) {
      console.log(`create a workspace: fdev fork --name ${suggestWorkspaceName(result.plan.machine)}`);
    }
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
  .command("completion [shell]")
  .description("Generate shell completion script")
  .action((shell?: string) => {
    console.log(renderCompletionScript(resolveCompletionShell(shell)));
  });

program
  .command("__complete", { hidden: true })
  .allowUnknownOption()
  .argument("[words...]", "completion words")
  .option("--shell <shell>", "completion shell")
  .option("--index <index>", "current word index")
  .action((words: string[], options: CompletionOptions) => {
    const shell = resolveCompletionShell(options.shell);
    const currentIndex = options.index === undefined ? undefined : Number(options.index);
    const items = completeFdev({
      words,
      currentIndex: Number.isFinite(currentIndex) ? currentIndex : undefined,
      cwd: process.cwd(),
    });
    const output = formatCompletionItems(items, shell);
    if (output) console.log(output);
  });

if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function runInit(command: Command, options: InitOptions): Promise<void> {
  const answers = await resolveInitAnswers(options, wantsJson(command));
  const paths = resolveInitProjectPaths(command, answers.name);

  if (existsSync(paths.configPath) && !options.force) {
    throw new Error(`${paths.configPath} already exists. Pass --force to overwrite it.`);
  }

  const result = initProject({
    projectDir: paths.projectDir,
    configPath: paths.configPath,
    name: answers.name,
    apiKey: answers.apiKey,
    force: options.force,
  });
  const install = await runPackageManagerInstall(paths.projectDir, answers.packageManager, wantsJson(command));

  if (wantsJson(command)) {
    printJson({ ...result, install });
    return;
  }

  printInitResult(result, install);
}

async function resolveInitAnswers(
  options: InitOptions,
  jsonMode: boolean,
): Promise<{ name: string; apiKey: string; packageManager: PackageManager }> {
  if (jsonMode && (options.name === undefined || !options.apiKey?.trim())) {
    throw new Error(`fdev init --json requires --name and --api-key`);
  }

  if (jsonMode && options.packageManager && options.packageManager !== "skip") {
    throw new Error(`fdev init --json only supports --package-manager skip`);
  }

  if (options.name === undefined || !options.apiKey) {
    assertInteractiveInit();
  }

  if (!jsonMode) {
    console.log(chalk.bold("Initialize fdev"));
    console.log(chalk.dim("This creates a project folder with fdev.config.ts, .env, package.json, and local ignore rules."));
    console.log("");
  }

  const name = options.name !== undefined
    ? normalizeMachineName(options.name)
    : await promptName();
  const apiKey = options.apiKey?.trim() || await promptRequiredSecret("Freestyle API key");
  const packageManager = options.packageManager ?? (jsonMode || !canPrompt() ? "skip" : await promptPackageManager("skip"));

  return {
    name,
    apiKey,
    packageManager,
  };
}

function assertInteractiveInit(): void {
  if (canPrompt()) return;
  throw new Error(`fdev init needs --name and --api-key when not running in an interactive terminal`);
}

function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveInitProjectPaths(command: Command, name: string): { projectDir: string; configPath: string } {
  const options = command.optsWithGlobals() as GlobalOptions;
  if (options.config) {
    throw new Error(`fdev init does not support --config. Use -C/--project to choose the parent directory.`);
  }

  const parentDir = resolve(process.cwd(), options.project ?? ".");
  const projectDir = resolve(parentDir, name);
  return {
    projectDir,
    configPath: join(projectDir, DEFAULT_CONFIG_FILE),
  };
}

async function promptName(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (;;) {
      const prompt = `${chalk.cyan("?")} Project name: `;
      const answer = await rl.question(prompt);
      try {
        return normalizeMachineName(answer);
      } catch (error) {
        console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      }
    }
  } finally {
    rl.close();
  }
}

async function promptRequiredSecret(label: string): Promise<string> {
  for (;;) {
    const value = (await promptSecret(label)).trim();
    if (value) return value;
    console.log(chalk.red(`${label} is required.`));
  }
}

async function promptPackageManager(defaultValue: PackageManager): Promise<PackageManager> {
  const choices: Array<{ value: PackageManager; label: string; hint: string }> = [
    { value: "npm", label: "npm", hint: "npm install" },
    { value: "bun", label: "bun", hint: "bun install" },
    { value: "pnpm", label: "pnpm", hint: "pnpm install" },
    { value: "skip", label: "skip", hint: "do not install now" },
  ];
  const stdin = process.stdin;
  if (stdin.isTTY && process.stdout.isTTY) {
    return await promptSelect("Install dependencies?", choices, defaultValue);
  }

  return await promptPackageManagerText(defaultValue);
}

async function promptPackageManagerText(defaultValue: PackageManager): Promise<PackageManager> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const choices = "npm, bun, pnpm, skip";

  try {
    for (;;) {
      const prompt = `${chalk.cyan("?")} Install dependencies with which package manager? ${chalk.dim(`(${choices}; default ${defaultValue})`)} `;
      const answer = (await rl.question(prompt)).trim().toLowerCase();
      const value = answer || defaultValue;
      if (isPackageManager(value)) return value;
      console.log(chalk.red(`Choose one of: ${choices}.`));
    }
  } finally {
    rl.close();
  }
}

async function promptSelect<T extends string>(
  label: string,
  choices: Array<{ value: T; label: string; hint?: string }>,
  defaultValue: T,
): Promise<T> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue);
  let index = defaultIndex >= 0 ? defaultIndex : 0;
  let rendered = false;
  const lineCount = choices.length + 1;

  return new Promise<T>((resolvePromise, reject) => {
    const wasRaw = stdin.isRaw;

    const render = () => {
      if (rendered) {
        stdout.write(`\x1b[${lineCount}A\x1b[J`);
      }
      rendered = true;
      stdout.write(`${chalk.cyan("?")} ${label}\n`);
      for (const [choiceIndex, choice] of choices.entries()) {
        const selected = choiceIndex === index;
        const pointer = selected ? chalk.cyan("›") : " ";
        const name = selected ? chalk.cyan(choice.label) : choice.label;
        const hint = choice.hint ? chalk.dim(` ${choice.hint}`) : "";
        stdout.write(`${pointer} ${name}${hint}\n`);
      }
    };

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\x1b[?25h");
    };

    const finish = () => {
      const selected = choices[index]!;
      if (rendered) {
        stdout.write(`\x1b[${lineCount}A\x1b[J`);
      }
      cleanup();
      stdout.write(`${chalk.cyan("?")} ${label} ${chalk.green(selected.label)}\n`);
      resolvePromise(selected.value);
    };

    const cancel = () => {
      cleanup();
      stdout.write("\n");
      reject(new Error("Init cancelled."));
    };

    const move = (delta: number) => {
      index = (index + delta + choices.length) % choices.length;
      render();
    };

    const onData = (chunk: Buffer | string) => {
      const key = String(chunk);
      if (key.includes("\u0003")) {
        cancel();
        return;
      }

      for (let offset = 0; offset < key.length;) {
        if (key.startsWith("\u001b[A", offset)) {
          move(-1);
          offset += 3;
          continue;
        }
        if (key.startsWith("\u001b[B", offset)) {
          move(1);
          offset += 3;
          continue;
        }

        const char = key[offset]!;
        if (char === "\r" || char === "\n" || char === " ") {
          finish();
          return;
        }
        if (char === "k") {
          move(-1);
          offset += 1;
          continue;
        }
        if (char === "j") {
          move(1);
          offset += 1;
          continue;
        }

        const numericChoice = Number(char);
        if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= choices.length) {
          index = numericChoice - 1;
          finish();
          return;
        }

        offset += 1;
      }
    };

    stdout.write("\x1b[?25l");
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    render();
  });
}

async function promptSecret(label: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const canUseRawMode = Boolean(stdin.isTTY && stdout.isTTY && stdin.setRawMode);

  if (!canUseRawMode) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return await rl.question(`${chalk.cyan("?")} ${label}: `);
    } finally {
      rl.close();
    }
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const finish = () => {
      cleanup();
      stdout.write("\n");
      resolve(value);
    };

    const cancel = () => {
      cleanup();
      stdout.write("\n");
      reject(new Error("Init cancelled."));
    };

    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") {
          cancel();
          return;
        }

        if (char === "\r" || char === "\n") {
          finish();
          return;
        }

        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }

        if (char >= " ") {
          value += char;
          stdout.write("*");
        }
      }
    };

    stdout.write(`${chalk.cyan("?")} ${label}: `);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function runPackageManagerInstall(
  projectDir: string,
  packageManager: PackageManager,
  jsonMode: boolean,
): Promise<InitInstallResult> {
  if (packageManager === "skip") {
    return { packageManager, skipped: true };
  }

  const command = packageManagerInstallCommand(packageManager);
  if (!jsonMode) {
    console.log("");
    console.log(`${chalk.cyan("installing")} ${command.join(" ")}`);
  }

  const proc = Bun.spawn(command, {
    cwd: projectDir,
    stdin: "inherit",
    stdout: jsonMode ? "pipe" : "inherit",
    stderr: jsonMode ? "pipe" : "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }

  return { packageManager, command: command.join(" "), skipped: false };
}

function printInitResult(result: InitProjectResult, install: InitInstallResult): void {
  console.log("");
  console.log(`${chalk.green("fdev initialized")} ${chalk.bold(result.name)}`);
  printInitLine(result.created.config ? "created" : "updated", result.configPath);
  printInitLine(result.created.env ? "created" : result.updated.envApiKey ? "updated" : "kept", result.envPath);
  printInitLine(result.created.envExample ? "created" : "kept", result.envExamplePath);
  printInitLine(result.created.packageJson ? "created" : result.updated.packageJson ? "updated" : "kept", result.packageJsonPath);
  printInitLine(result.created.gitignore ? "created" : result.updated.gitignore ? "updated" : "kept", result.gitignorePath);

  if (result.updated.sdkDependency) {
    console.log(`${chalk.green("pinned")} ${SDK_PACKAGE_NAME}@${FDEV_CLI_VERSION}`);
  }

  if (install.skipped) {
    console.log(`${chalk.dim("install")} skipped`);
  } else if (install.command) {
    console.log(`${chalk.green("installed")} ${install.command}`);
  }

  console.log("");
  console.log(chalk.bold("Next steps"));
  console.log(`  cd ${displayProjectDir(result.projectDir)}`);
  if (install.skipped) {
    console.log(`  ${detectInstallCommand(result.packageJsonPath)}`);
  }
  console.log("  fdev plan");
}

function displayProjectDir(projectDir: string): string {
  const path = relative(process.cwd(), projectDir);
  return path && !path.startsWith("..") ? path : projectDir;
}

function printInitLine(status: "created" | "updated" | "kept", path: string): void {
  const color = status === "kept" ? chalk.dim : status === "updated" ? chalk.yellow : chalk.green;
  console.log(`${color(status.padEnd(7))} ${path}`);
}

function detectInstallCommand(packageJsonPath: string): string {
  const projectDir = dirname(packageJsonPath);
  if (existsSync(join(projectDir, "bun.lock")) || existsSync(join(projectDir, "bun.lockb"))) return "bun install";
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm install";
  if (existsSync(join(projectDir, "yarn.lock"))) return "yarn install";
  if (existsSync(join(projectDir, "package-lock.json"))) return "npm install";
  return "npm install";
}

function parsePackageManager(value: string): PackageManager {
  const normalized = value.trim().toLowerCase();
  if (isPackageManager(normalized)) return normalized;
  throw new Error(`Expected npm, bun, pnpm, or skip`);
}

function isPackageManager(value: string): value is PackageManager {
  return value === "npm" || value === "bun" || value === "pnpm" || value === "skip";
}

function packageManagerInstallCommand(packageManager: Exclude<PackageManager, "skip">): string[] {
  switch (packageManager) {
    case "bun":
      return ["bun", "install"];
    case "pnpm":
      return ["pnpm", "install"];
    case "npm":
      return ["npm", "install"];
  }
}

async function loadEngine(command: Command): Promise<DevMachineEngine> {
  const engineOptions = resolveEngineOptions(command);
  assertVersionAlignment(engineOptions.projectDir);
  const engine = await createDevMachineEngine({
    ...engineOptions,
    interaction: {
      terminal: createLocalTerminalInteraction(),
    },
  });
  if (!wantsJson(command)) engine.onEvent(renderEvent);
  await engine.load();
  return engine;
}

function resolveEngineOptions(command: Command): { projectDir: string; configPath?: string } {
  const paths = resolveCommandConfigPaths(command);
  const options = command.optsWithGlobals() as GlobalOptions;
  if (options.config) {
    return { projectDir: paths.projectDir, configPath: paths.configPath };
  }
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
  console.log(`${plan.machine}: ${plan.cachedPrefixLength}/${plan.steps.length} steps cached`);
  if (plan.cachedSnapshotId) console.log(`snapshot: ${plan.cachedSnapshotId}`);

  const rows = plan.steps.map((step) => [
    String(step.index + 1),
    step.status,
    step.name,
  ]);
  printTable(["#", "status", "step"], rows);
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
    ["snapshot", "machine", "prefix", "step", "created"],
    snapshots.map((snapshot) => [
      snapshot.snapshotId,
      snapshot.machine,
      String(snapshot.prefixLength),
      snapshot.stepName,
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
    ["provider", info.machine?.providerId ?? ""],
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

function suggestWorkspaceName(machine: string): string {
  return normalizeMachineName(`${machine}-work`);
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
      console.error(`plan ${event.machine}: ${event.cachedPrefixLength}/${event.stepCount} cached`);
      return;
    case "vm.created":
      console.error(event.fromSnapshotId ? `vm ${event.vmId} from ${event.fromSnapshotId}` : `vm ${event.vmId} created`);
      return;
    case "step.skipped":
      console.error(`step ${event.step} cached at ${event.snapshotId}`);
      return;
    case "step.started":
      console.error(`step ${event.step}`);
      return;
    case "command.started":
      console.error(`command ${event.commandName}`);
      return;
    case "command.output":
      process.stderr.write(event.data);
      return;
    case "command.completed":
      console.error(`command ${event.commandName} exited ${event.exitCode}`);
      return;
    case "interaction.awaiting_user":
      console.error(`interaction ${event.label}`);
      return;
    case "interaction.completed":
      console.error(`interaction ${event.label} completed`);
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
