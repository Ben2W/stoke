#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import chalk from "chalk";
import { Command, CommanderError } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import {
  getOrStartRuntime,
  type RuntimeClient,
} from "@rigkit/runtime-client";
import {
  type DevMachineEvent,
  type WorkflowPlan,
  type SnapshotRecord,
  type WorkspaceRecord,
} from "@rigkit/engine";
import {
  cmuxHostCapabilities,
  type CmuxHostCapabilityHandler,
} from "@rigkit/provider-cmux/host";
import { DEFAULT_CONFIG_FILE, discoverProjectConfigs, resolveConfigPaths, PROJECT_PACKAGE_NAME } from "./project.ts";
import {
  materializeGithubProject,
  splitGithubProjectTarget,
  type GithubProjectTarget,
} from "./remote-project.ts";
import { RIGKIT_CLI_VERSION } from "./version.ts";
import { initProject, normalizeMachineName, type InitProjectResult } from "./init.ts";
import { openExternalTarget } from "./interaction.ts";
import { createRunPresenter, type RunPresenter } from "./run-presenter.ts";
import {
  completeRig,
  formatCompletionItems,
  renderCompletionScript,
  resolveCompletionShell,
  type CompletionShell,
} from "./completion.ts";

type GlobalOptions = {
  project?: string;
  config?: string;
  state?: string;
  json: boolean;
};

type CliInvocation = {
  global: GlobalOptions;
  json: boolean;
};

type InitOptions = {
  force: boolean;
  name?: string;
  apiKey?: string;
  packageManager?: PackageManager;
};

type CompletionOptions = {
  shell?: CompletionShell;
  index?: string;
};

type DoctorOptions = {
  cli: boolean;
};

type RunOptions = {
  all: boolean;
  discover: boolean;
};

type ListOptions = {
  target?: string;
};

type PackageManager = "npm" | "bun" | "pnpm" | "skip";

type InitInstallResult = {
  packageManager: PackageManager;
  command?: string;
  skipped: boolean;
  reported?: boolean;
};

type EngineProjectInfo = {
  projectDir: string;
  configPath: string;
  statePath: string;
  workflow?: {
    name: string;
    providers: string[];
  };
};

type RuntimeOperationManifest = {
  operations: RuntimeOperationDefinition[];
  workspaceOperations?: RuntimeOperationDefinition[];
};

type RuntimeOperationDefinition = {
  id: string;
  aliases?: string[];
  title?: string;
  description?: string;
  createsWorkspace?: boolean;
  cli?: {
    positionals?: Array<{ name: string; index: number }>;
    options?: Array<{
      name: string;
      flag: string;
      aliases?: string[];
      required?: boolean;
      runtime?: boolean;
      type?: "string" | "boolean" | "number";
    }>;
  };
  inputSchema?: {
    properties?: Record<string, { type?: string; default?: unknown }>;
    required?: string[];
  };
};

type RuntimeOperationCliOption = NonNullable<NonNullable<RuntimeOperationDefinition["cli"]>["options"]>[number];

type ParsedOperationInput = {
  input: Record<string, unknown>;
  hostOptions: Record<string, unknown>;
};

const CLI_HOST_METHODS = [
  { id: "message.show" },
  { id: "prompt.text" },
  { id: "prompt.confirm" },
  { id: "prompt.select" },
  { id: "open.external" },
  { id: "host.command.run", modes: ["capture", "interactive"] },
];

const CLI_HOST_CAPABILITY_HANDLERS = new Map<string, CmuxHostCapabilityHandler>(
  cmuxHostCapabilities.map((capability) => [capability.id, capability]),
);

const CLI_HOST_CAPABILITIES: Array<{ id: string; schemaHash?: string }> = [
  ...CLI_HOST_CAPABILITY_HANDLERS.values(),
].map((capability) => ({
  id: capability.id,
  ...(capability.schemaHash ? { schemaHash: capability.schemaHash } : {}),
}));

const MANAGEMENT_COMMANDS = new Set([
  "completion",
  "doctor",
  "help",
  "init",
  "ls",
  "projects",
  "run",
  "version",
]);

const GLOBAL_OPTIONS_WITH_VALUES = new Set(["-C", "--project", "--config", "--state"]);

if (process.argv[2] === "__complete") {
  runCompletionEndpoint(process.argv.slice(3)).catch(handleCliError);
} else {
  runCli(normalizeOperationArgv(process.argv)).catch(handleCliError);
}

function normalizeOperationArgv(argv: string[]): string[] {
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") return argv;
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) {
      index += 1;
      continue;
    }
    if ([...GLOBAL_OPTIONS_WITH_VALUES].some((option) => arg.startsWith(`${option}=`))) continue;
    if (arg === "--json") continue;
    if (arg.startsWith("-")) return argv;
    if (MANAGEMENT_COMMANDS.has(arg)) return argv;
    return [...argv.slice(0, 2), ...args.slice(0, index), "run", ...args.slice(index)];
  }
  return argv;
}

async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("rig")
    .description("Rigkit workflow CLI")
    .usage("[options] <command|operation>")
    .version(RIGKIT_CLI_VERSION, "-v, --version", "Show Rigkit CLI version")
    .showHelpAfterError()
    .exitOverride()
    .argument("[command]")
    .option("-C, --project <project>", `Project directory containing ${DEFAULT_CONFIG_FILE}`)
    .option("--config <config>", "Exact config file to load")
    .option("--state <state>", "Local runtime state database path")
    .option("--json", "Print machine-readable JSON where supported")
    .action(async (command?: string) => {
      if (command) program.error(`unknown command '${command}'`);
      await runHelp(makeInvocation(rootOptions(program)));
    });

  program
    .command("init")
    .description("Initialize a Rigkit project")
    .option("--name <name>", "Project and workflow name")
    .option("--api-key <apiKey>", "Freestyle API key")
    .option("--package-manager <packageManager>", "Install with npm, bun, pnpm, or skip")
    .option("--force", "Overwrite an existing config file")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: {
      name?: string;
      apiKey?: string;
      packageManager?: string;
      force?: boolean;
      json?: boolean;
    }) => {
      await runInit(makeInvocation(rootOptions(program), options.json), {
        name: options.name,
        apiKey: options.apiKey,
        packageManager: parsePackageManagerOption(options.packageManager),
        force: Boolean(options.force),
      });
    });

  program
    .command("run <operation> [args...]", { hidden: true })
    .description("Run a project operation exposed by the runtime")
    .allowUnknownOption(true)
    .option("--all", "Run against every discovered project")
    .option("--discover", "Discover projects below the selected directory")
    .option("--json", "Print machine-readable JSON")
    .action(async (
      operation: string,
      args: string[],
      options: { all?: boolean; discover?: boolean; json?: boolean },
    ) => {
      await runProjectOperation(makeInvocation(rootOptions(program), options.json), operation, args ?? [], {
        all: Boolean(options.all),
        discover: Boolean(options.discover),
      });
    });

  program
    .command("ls [target]")
    .description("List project workspaces")
    .option("--json", "Print machine-readable JSON")
    .action(async (target: string | undefined, options: { json?: boolean }) => {
      await runList(makeInvocation(rootOptions(program), options.json), { target });
    });

  program
    .command("projects")
    .description("Discover Rigkit projects below the current directory")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await runProjects(makeInvocation(rootOptions(program), options.json));
    });

  program
    .command("doctor")
    .description("Show Rigkit runtime diagnostics")
    .option("--cli", "Show CLI diagnostics without connecting to a project runtime")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { cli?: boolean; json?: boolean }) => {
      await runDoctor(makeInvocation(rootOptions(program), options.json), { cli: Boolean(options.cli) });
    });

  program
    .command("version")
    .description("Show Rigkit CLI version")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await runVersion(makeInvocation(rootOptions(program), options.json));
    });

  program
    .command("help")
    .description("Show Rigkit CLI help")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await runHelp(makeInvocation(rootOptions(program), options.json));
    });

  program
    .command("completion [shell]")
    .description("Generate shell completion script")
    .action((shell?: string) => {
      console.log(renderCompletionScript(resolveCompletionShell(shell)));
    });
  await program.parseAsync(argv);
}

function rootOptions(program: Command): GlobalOptions {
  const options = program.opts<{
    project?: string;
    config?: string;
    state?: string;
    json?: boolean;
  }>();
  return {
    project: options.project,
    config: options.config,
    state: options.state,
    json: Boolean(options.json),
  };
}

function parsePackageManagerOption(value: string | undefined): PackageManager | undefined {
  if (value === undefined) return undefined;
  if (isPackageManager(value)) return value;
  throw new Error(`Unknown package manager ${value}. Expected npm, bun, pnpm, or skip.`);
}

function makeInvocation(global: GlobalOptions, commandJson = false): CliInvocation {
  return {
    global,
    json: Boolean(global.json || commandJson),
  };
}

async function runCompletionEndpoint(args: string[]): Promise<void> {
  const options = parseCompletionEndpointArgs(args);
  const shell = resolveCompletionShell(options.shell);
  const currentIndex = options.index === undefined ? undefined : Number(options.index);
  const items = await completeRig({
    words: options.words,
    currentIndex: Number.isFinite(currentIndex) ? currentIndex : undefined,
    cwd: process.cwd(),
  });
  const output = formatCompletionItems(items, shell);
  if (output) console.log(output);
}

function parseCompletionEndpointArgs(args: string[]): CompletionOptions & { words: string[] } {
  const words: string[] = [];
  const options: CompletionOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") {
      words.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--shell") {
      options.shell = args[++index] as CompletionShell | undefined;
      continue;
    }
    if (arg.startsWith("--shell=")) {
      options.shell = arg.slice("--shell=".length) as CompletionShell;
      continue;
    }
    if (arg === "--index") {
      options.index = args[++index];
      continue;
    }
    if (arg.startsWith("--index=")) {
      options.index = arg.slice("--index=".length);
      continue;
    }
    words.push(arg);
  }

  return { ...options, words };
}

function handleCliError(error: unknown): void {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runInit(invocation: CliInvocation, options: InitOptions): Promise<void> {
  const answers = await resolveInitAnswers(options, wantsJson(invocation));
  const paths = resolveInitProjectPaths(invocation, answers.name);

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
  const install = await runPackageManagerInstall(paths.projectDir, answers.packageManager, wantsJson(invocation));

  if (wantsJson(invocation)) {
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
    throw new Error(`rig init --json requires --name and --api-key`);
  }

  if (jsonMode && options.packageManager && options.packageManager !== "skip") {
    throw new Error(`rig init --json only supports --package-manager skip`);
  }

  if (options.name === undefined || !options.apiKey) {
    assertInteractiveInit();
  }

  if (!jsonMode) {
    console.log(chalk.bold("Initialize Rigkit"));
    console.log(chalk.dim("This creates a project folder with rig.config.ts, .env, package.json, and local ignore rules."));
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
  throw new Error(`rig init needs --name and --api-key when not running in an interactive terminal`);
}

function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveInitProjectPaths(invocation: CliInvocation, name: string): { projectDir: string; configPath: string } {
  const options = invocation.global;
  if (options.config) {
    throw new Error(`rig init does not support --config. Use -C/--project to choose the parent directory.`);
  }

  const parentDir = resolve(process.cwd(), options.project ?? ".");
  const projectDir = resolve(parentDir, name);
  return {
    projectDir,
    configPath: join(projectDir, DEFAULT_CONFIG_FILE),
  };
}

async function promptName(): Promise<string> {
  const answers = await inquirer.prompt<{ name: string }>([{
    type: "input",
    name: "name",
    message: "Project name:",
    validate(value: string) {
      try {
        normalizeMachineName(value);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    filter: (value: string) => normalizeMachineName(value),
  }]);
  return answers.name;
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
  const answers = await inquirer.prompt<{ packageManager: PackageManager }>([{
    type: "select",
    name: "packageManager",
    message: "Install dependencies?",
    default: defaultValue,
    choices: choices.map((choice) => ({
      name: choice.label,
      value: choice.value,
      description: choice.hint,
    })),
  }]);
  return answers.packageManager;
}

async function promptSecret(label: string): Promise<string> {
  const answers = await inquirer.prompt<{ value: string }>([{
    type: "password",
    name: "value",
    message: `${label}:`,
    mask: "*",
  }]);
  return answers.value;
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
  if (!jsonMode && process.stderr.isTTY) {
    const spinner = ora({
      text: `installing ${command.join(" ")}`,
      stream: process.stderr,
    }).start();
    const proc = Bun.spawn(command, {
      cwd: projectDir,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      spinner.fail(`${command.join(" ")} failed`);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
    }
    spinner.succeed(`installed ${command.join(" ")}`);
    return { packageManager, command: command.join(" "), skipped: false, reported: true };
  }

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
  console.log(`${chalk.green("Rigkit initialized")} ${chalk.bold(result.name)}`);
  printInitLine(result.created.config ? "created" : "updated", result.configPath);
  printInitLine(result.created.env ? "created" : result.updated.envApiKey ? "updated" : "kept", result.envPath);
  printInitLine(result.created.envExample ? "created" : "kept", result.envExamplePath);
  printInitLine(result.created.packageJson ? "created" : result.updated.packageJson ? "updated" : "kept", result.packageJsonPath);
  printInitLine(result.created.gitignore ? "created" : result.updated.gitignore ? "updated" : "kept", result.gitignorePath);

  if (result.updated.sdkDependency) {
    console.log(`${chalk.green("pinned")} ${PROJECT_PACKAGE_NAME}@${RIGKIT_CLI_VERSION}`);
  }

  if (install.skipped) {
    console.log(`${chalk.dim("install")} skipped`);
  } else if (install.command && !install.reported) {
    console.log(`${chalk.green("installed")} ${install.command}`);
  }

  console.log("");
  console.log(chalk.bold("Next steps"));
  console.log(`  cd ${displayProjectDir(result.projectDir)}`);
  if (install.skipped) {
    console.log(`  ${detectInstallCommand(result.packageJsonPath)}`);
  }
  console.log("  rig plan");
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

async function runProjectOperation(
  invocation: CliInvocation,
  requestedOperation: string,
  args: string[],
  options: RunOptions,
): Promise<void> {
  const remote = splitGithubProjectTarget(args);
  if ((options.all || options.discover) && remote.target) {
    throw new Error(`Remote GitHub project targets cannot be combined with --all or --discover`);
  }

  if (options.all || options.discover) {
    await runDiscoveredProjectOperation(invocation, requestedOperation, remote.args, { all: options.all });
    return;
  }

  const runtime = remote.target
    ? await loadGithubRuntime(invocation, remote.target)
    : await loadRuntime(invocation);
  const { operation, parsed, result } = await executeRuntimeOperation(
    invocation,
    runtime,
    requestedOperation,
    remote.args,
  );

  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }

  await renderOperationResult(operation, result, parsed.hostOptions);
}

async function runDiscoveredProjectOperation(
  invocation: CliInvocation,
  requestedOperation: string,
  args: string[],
  options: { all: boolean },
): Promise<void> {
  const projects = discoverProjectConfigs({
    project: invocation.global.project,
    config: invocation.global.config,
  });
  if (projects.length === 0) {
    throw new Error("No Rigkit projects found.");
  }
  if (!options.all && projects.length > 1) {
    throw new Error([
      "Multiple Rigkit projects found.",
      "Use `rig projects` to list candidates, pass -C/--project or --config to select one, or pass --all to run every discovered project.",
      ...projects.map((project) => `- ${project.configPath}`),
    ].join("\n"));
  }
  if (invocation.global.state && projects.length > 1) {
    throw new Error(`--state cannot be used with multiple discovered projects`);
  }

  const results: Array<{
    project: { projectDir: string; configPath: string };
    operation: string;
    result: unknown;
  }> = [];

  for (const project of projects) {
    const runtime = await getOrStartRuntime({
      projectDir: project.projectDir,
      configPath: project.configPath,
      statePath: invocation.global.state ? resolve(process.cwd(), invocation.global.state) : undefined,
    });
    const { operation, parsed, result } = await executeRuntimeOperation(
      invocation,
      runtime,
      requestedOperation,
      args,
    );
    results.push({
      project,
      operation: operation.id,
      result,
    });

    if (!wantsJson(invocation)) {
      if (projects.length > 1) {
        console.log(chalk.bold(displayProjectDir(project.projectDir)));
      }
      await renderOperationResult(operation, result, parsed.hostOptions);
    }
  }

  if (wantsJson(invocation)) {
    printJson({ projects: results });
  }
}

async function runProjects(invocation: CliInvocation): Promise<void> {
  const projects = discoverProjectConfigs({
    project: invocation.global.project,
    config: invocation.global.config,
  });
  if (wantsJson(invocation)) {
    printJson({ projects });
    return;
  }
  if (projects.length === 0) {
    console.log("No Rigkit projects found.");
    return;
  }
  printTable(["project", "config"], projects.map((project) => [
    project.projectDir,
    project.configPath,
  ]));
}

async function runList(invocation: CliInvocation, options: ListOptions): Promise<void> {
  const target = normalizeListTarget(options.target);
  const runtime = await loadRuntime(invocation);

  if (target === "workspaces") {
    const { workspaces } = await runtime.control.workspaces();
    if (wantsJson(invocation)) {
      printJson({ workspaces });
      return;
    }
    printWorkspaces(workspaces);
    return;
  }

  if (target === "snapshots") {
    const { snapshots } = await runtime.control.snapshots();
    if (wantsJson(invocation)) {
      printJson({ snapshots });
      return;
    }
    printSnapshots(snapshots as SnapshotRecord[]);
    return;
  }

  const project = await readRuntimeProject(runtime);
  if (wantsJson(invocation)) {
    printJson(project);
    return;
  }
  printConfig(project);
}

async function executeRuntimeOperation(
  invocation: CliInvocation,
  runtime: RuntimeClient,
  requestedOperation: string,
  args: string[],
): Promise<{
  operation: RuntimeOperationDefinition;
  parsed: ParsedOperationInput;
  result: unknown;
}> {
  const manifest = await readRuntimeOperations(runtime);
  const resolved = findRuntimeOperation(manifest, requestedOperation);
  if (!resolved) {
    throw new Error(`This project does not define a Rigkit operation named "${requestedOperation}".`);
  }
  const { operation, runOperation } = resolved;

  const parsed = parseOperationArgs(operation, args);
  enforceHostOnlyBooleanGuards(operation, parsed);

  const result = await runRuntimeOperation<unknown>(
    runtime,
    runOperation,
    parsed.input,
    { renderEvents: !wantsJson(invocation) },
  );

  return { operation, parsed, result };
}

function findRuntimeOperation(
  manifest: RuntimeOperationManifest,
  requestedOperation: string,
): { operation: RuntimeOperationDefinition; runOperation: string } | undefined {
  const workspaceOperation = parseWorkspaceOperationId(requestedOperation);
  if (workspaceOperation) {
    const operation = (manifest.workspaceOperations ?? []).find((item) => item.id === workspaceOperation.operation);
    return operation ? { operation, runOperation: requestedOperation } : undefined;
  }

  const operation = manifest.operations.find((operation) =>
    operation.id === requestedOperation || operation.aliases?.includes(requestedOperation)
  );
  return operation ? { operation, runOperation: operation.id } : undefined;
}

function parseWorkspaceOperationId(value: string): { workspace: string; operation: string } | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return {
    workspace: value.slice(0, slash),
    operation: value.slice(slash + 1),
  };
}

function parseOperationArgs(operation: RuntimeOperationDefinition, args: string[]): ParsedOperationInput {
  const cli = inferCliMetadata(operation);
  const input: Record<string, unknown> = {};
  const hostOptions: Record<string, unknown> = {};
  const positionals = cli.positionals ?? [];
  let positionalIndex = 0;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      for (const value of args.slice(index + 1)) {
        assignPositional(positionals, positionalIndex++, value, input);
      }
      break;
    }

    if (arg.startsWith("--")) {
      const [flag, inlineValue] = splitFlag(arg);
      const option = cli.options?.find((item) => item.flag === flag || item.aliases?.includes(flag));
      if (!option) throw new Error(`Unknown option ${flag} for operation ${operation.id}`);
      const rawValue = option.type === "boolean"
        ? inlineValue ?? true
        : inlineValue ?? readOptionValue(args, ++index, flag);
      assignCliValue(option, rawValue, input, hostOptions);
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      const option = cli.options?.find((item) => item.flag === arg || item.aliases?.includes(arg));
      if (!option) throw new Error(`Unknown option ${arg} for operation ${operation.id}`);
      const rawValue = option.type === "boolean" ? true : readOptionValue(args, ++index, arg);
      assignCliValue(option, rawValue, input, hostOptions);
      continue;
    }

    assignPositional(positionals, positionalIndex++, arg, input);
  }

  for (const option of cli.options ?? []) {
    if (option.required && input[option.name] === undefined && hostOptions[option.name] === undefined) {
      throw new Error(`Operation ${operation.id} requires ${option.flag}`);
    }
  }

  for (const name of operation.inputSchema?.required ?? []) {
    if (input[name] === undefined) {
      throw new Error(`Operation ${operation.id} requires ${name}`);
    }
  }

  return { input, hostOptions };
}

function enforceHostOnlyBooleanGuards(
  operation: RuntimeOperationDefinition,
  parsed: ParsedOperationInput,
): void {
  const guard = operation.cli?.options?.find((option) =>
    option.runtime === false &&
    option.type === "boolean" &&
    (option.name === "yes" || option.name === "confirm") &&
    parsed.hostOptions[option.name] !== true
  );
  if (!guard) return;
  throw new Error(`Operation ${operation.id} requires ${guard.flag}`);
}

function inferCliMetadata(operation: RuntimeOperationDefinition): Required<NonNullable<RuntimeOperationDefinition["cli"]>> {
  const properties = operation.inputSchema?.properties ?? {};
  return {
    positionals: operation.cli?.positionals ?? [],
    options: operation.cli?.options ?? Object.entries(properties).map(([name, schema]) => ({
      name,
      flag: `--${dashCase(name)}`,
      required: operation.inputSchema?.required?.includes(name),
      type: schema.type === "boolean" ? "boolean" : schema.type === "number" ? "number" : "string",
    })),
  };
}

function dashCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function splitFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index < 0 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function assignCliValue(
  option: RuntimeOperationCliOption,
  rawValue: unknown,
  input: Record<string, unknown>,
  hostOptions: Record<string, unknown>,
): void {
  const value = coerceCliValue(rawValue, option.type ?? "string", option.flag);
  const target = option.runtime === false ? hostOptions : input;
  target[option.name] = value;
}

function assignPositional(
  positionals: Array<{ name: string; index: number }>,
  index: number,
  value: string,
  input: Record<string, unknown>,
): void {
  const positional = positionals.find((item) => item.index === index);
  if (!positional) throw new Error(`Unexpected positional argument ${value}`);
  input[positional.name] = value;
}

function coerceCliValue(value: unknown, type: "string" | "boolean" | "number", flag: string): unknown {
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${flag} expects true or false`);
  }
  if (type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${flag} expects a number`);
    return number;
  }
  return String(value);
}

async function renderOperationResult(
  operation: RuntimeOperationDefinition,
  result: unknown,
  hostOptions: Record<string, unknown>,
): Promise<void> {
  if (isWorkflowPlan(result)) {
    printPlan(result);
    return;
  }

  if (isRecord(result) && isWorkflowPlan(result.plan)) {
    if (result.dryRun === true) {
      printPlan(result.plan);
      console.log("No changes applied.");
      return;
    }
    console.log(`resolved ${result.plan.workflow}`);
    return;
  }

  if (operation.createsWorkspace && isWorkspaceRecord(result)) {
    console.log(result.name);
    return;
  }

  if (isRecord(result) && typeof result.command === "string") {
    const commandResult = isRecord(result.commandResult) ? result.commandResult : undefined;
    if (!commandResult || hostOptions.print === true) {
      console.log(result.command);
      return;
    }
    const exitCode = typeof commandResult.exitCode === "number" ? commandResult.exitCode : 0;
    if (exitCode !== 0) throw new Error(`Host command failed with exit code ${exitCode}`);
    return;
  }

  if (isWorkspaceRecord(result)) {
    console.log(result.name);
    return;
  }

  printJson(result);
}

async function runDoctor(invocation: CliInvocation, options: DoctorOptions): Promise<void> {
  if (options.cli) {
    const diagnostics = {
      cliVersion: RIGKIT_CLI_VERSION,
      binary: process.argv[1] ? resolve(process.argv[1]) : undefined,
      node: process.version,
      bun: typeof Bun !== "undefined" ? Bun.version : undefined,
    };
    if (wantsJson(invocation)) {
      printJson(diagnostics);
      return;
    }
    printTable(["key", "value"], [
      ["cli", diagnostics.cliVersion],
      ["binary", diagnostics.binary ?? ""],
      ["node", diagnostics.node],
      ["bun", diagnostics.bun ?? ""],
    ]);
    return;
  }

  const runtime = await loadRuntime(invocation);
  const [health, runtimeInfo, project] = await Promise.all([
    runtime.control.health(),
    runtime.control.runtime(),
    readRuntimeProject(runtime),
  ]);
  const diagnostics = {
    cliVersion: RIGKIT_CLI_VERSION,
    project,
    daemon: {
      url: runtime.handle.url,
      pid: runtime.handle.pid,
      handlePath: runtime.paths.handlePath,
      tokenPath: runtime.handle.tokenPath,
      expiresAt: health.expiresAt ?? runtime.handle.expiresAt,
    },
    runtime: runtimeInfo,
  };

  if (wantsJson(invocation)) {
    printJson(diagnostics);
    return;
  }

  printTable(["key", "value"], [
    ["cli", RIGKIT_CLI_VERSION],
    ["project", project.projectDir],
    ["config", project.configPath],
    ["runtime handle", runtime.paths.handlePath],
    ["daemon", runtime.handle.url],
    ["daemon pid", String(runtime.handle.pid)],
    ["engine", runtimeInfo.engineVersion],
    ["runtime", runtimeInfo.runtimeVersion],
    ["api version", String(runtimeInfo.apiVersion)],
    ["protocol", runtimeInfo.protocolHash],
    ["state", project.statePath ?? ""],
    ["expires", health.expiresAt ?? runtime.handle.expiresAt ?? ""],
  ]);
}

async function runVersion(invocation: CliInvocation): Promise<void> {
  if (wantsJson(invocation)) {
    printJson({ cliVersion: RIGKIT_CLI_VERSION });
    return;
  }
  console.log(RIGKIT_CLI_VERSION);
}

async function runHelp(invocation: CliInvocation): Promise<void> {
  if (wantsJson(invocation)) {
    printJson({
      name: "rig",
      version: RIGKIT_CLI_VERSION,
      commands: [
        { name: "help", description: "Show Rigkit CLI help" },
        { name: "init", description: "Initialize a Rigkit project" },
        { name: "<operation>", description: "Run a project operation exposed by the runtime" },
        { name: "ls", description: "List project workspaces" },
        { name: "projects", description: "Discover Rigkit projects below the current directory" },
        { name: "doctor", description: "Show Rigkit runtime diagnostics" },
        { name: "version", description: "Show Rigkit CLI version" },
        { name: "completion", description: "Generate shell completion script" },
      ],
    });
    return;
  }
  console.log([
    `rig ${RIGKIT_CLI_VERSION}`,
    "",
    "Usage:",
    "  rig [options] <command|operation>",
    "",
    "Commands:",
    "  help        Show Rigkit CLI help",
    "  init        Initialize a Rigkit project",
    "  <operation> Run a project operation exposed by the runtime",
    "  ls          List project workspaces",
    "  projects    Discover Rigkit projects below the current directory",
    "  doctor      Show Rigkit runtime diagnostics",
    "  version     Show Rigkit CLI version",
    "  completion  Generate shell completion script",
    "",
    "Options:",
    "  -C, --project <dir>  Project directory containing rig.config.ts",
    "  --config <file>      Exact config file to load",
    "  --state <file>       Local runtime state database path",
    "  --json               Print machine-readable JSON where supported",
  ].join("\n"));
}

async function loadRuntime(invocation: CliInvocation): Promise<RuntimeClient> {
  const engineOptions = resolveEngineOptions(invocation);
  return await getOrStartRuntime(engineOptions);
}

async function loadGithubRuntime(invocation: CliInvocation, target: GithubProjectTarget): Promise<RuntimeClient> {
  if (invocation.global.project || invocation.global.config || invocation.global.state) {
    throw new Error(`Remote GitHub project targets cannot be combined with -C/--project, --config, or --state`);
  }

  await confirmGithubProjectTarget(target);
  const project = await materializeGithubProject(target);
  if (!wantsJson(invocation)) {
    console.error(`github ${target.owner}/${target.repo}@${project.commitSha.slice(0, 12)}`);
  }
  return await getOrStartRuntime({
    projectDir: project.projectDir,
    configPath: project.configPath,
    statePath: project.statePath,
    source: {
      kind: "github",
      target: target.raw,
      repoUrl: project.repoUrl,
      ref: project.ref,
      commitSha: project.commitSha,
    },
  });
}

async function confirmGithubProjectTarget(target: GithubProjectTarget): Promise<void> {
  if (process.env.RIGKIT_TRUST_REMOTE_CONFIGS === "1") return;
  const repo = `https://github.com/${target.owner}/${target.repo}`;
  const ref = target.ref ? ` at ${target.ref}` : "";
  const message = `Run and install dependencies for ${repo}${ref}?`;

  if (!canPrompt()) {
    throw new Error(
      `Remote GitHub project ${target.raw} executes code on this machine. ` +
        `Run from an interactive terminal or set RIGKIT_TRUST_REMOTE_CONFIGS=1 to allow it explicitly.`,
    );
  }

  console.error("");
  console.error(chalk.yellow("Remote Rigkit configs execute code on this machine."));
  console.error(`Project: ${repo}${ref}`);
  const allowed = await promptHostConfirm({ message, defaultValue: false });
  if (!allowed) throw new Error(`Remote GitHub project denied`);
}

async function readRuntimeProject(runtime: RuntimeClient): Promise<EngineProjectInfo> {
  return await runtime.control.project() as EngineProjectInfo;
}

async function readRuntimeOperations(runtime: RuntimeClient): Promise<RuntimeOperationManifest> {
  return await runtime.control.operations() as unknown as RuntimeOperationManifest;
}

async function runRuntimeOperation<T>(
  runtime: RuntimeClient,
  operation: string,
  input: Record<string, unknown>,
  options: { renderEvents: boolean },
): Promise<T> {
  const started = await runtime.control.startRun({ operation, input });
  let presenter: RunPresenter | undefined = options.renderEvents
    ? createRunPresenter(operation)
    : undefined;
  let result: T | undefined;
  let failure: Error | undefined;

  const handleEvent = async (
    event: unknown,
    respond?: (id: string, response: unknown) => void | Promise<void>,
    sendSession?: (message: unknown) => void | Promise<void>,
  ) => {
    if (isHostRequestEvent(event)) {
      const suspendPresenter = hostRequestNeedsTerminal(event);
      if (suspendPresenter) presenter?.pause();
      try {
        if (respond) {
          await answerHostRequestOverSession(respond, event, { quietOpen: Boolean(presenter) });
        } else {
          await answerHostRequest(runtime, event, { quietOpen: Boolean(presenter) });
        }
      } finally {
        if (suspendPresenter) presenter?.resume();
      }
      return;
    }
    if (isHostCapabilityRequestEvent(event)) {
      presenter?.pause();
      try {
        if (sendSession) {
          await answerHostCapabilityRequestOverSession(sendSession, event);
        } else if (respond) {
          await answerHostCapabilityRequestOverSession((message) => {
            if (isRecord(message) && message.type === "response") {
              const id = typeof message.id === "string" ? message.id : undefined;
              if (id) return respond(id, "error" in message ? { error: message.error } : { result: message.result });
            }
            throw new Error(`Session response channel cannot send ${String(isRecord(message) ? message.type : typeof message)}`);
          }, event);
        } else {
          await answerHostCapabilityRequest(runtime, event);
        }
      } finally {
        presenter?.resume();
      }
      return;
    }
    if (isRecord(event) && event.type === "run.completed") {
      presenter?.render({ ...event, type: "run.completed" });
      result = event.result as T;
      return;
    }
    if (isRecord(event) && event.type === "run.failed") {
      const message = isRecord(event.error) && typeof event.error.message === "string"
        ? event.error.message
        : "Runtime operation failed";
      failure = new Error(message);
      presenter?.render({ ...event, type: "run.failed" });
      return;
    }
    if (options.renderEvents && isDevMachineEvent(event)) {
      if (presenter) presenter.render(event);
      else renderEvent(event);
    }
  };

  try {
    if (started.sessionUrl) {
      await runtime.runSession(started.runId, {
        hello: {
          type: "hello",
          transportVersion: 1,
          host: {
            name: "rigkit-cli",
            version: RIGKIT_CLI_VERSION,
          },
          hostMethods: CLI_HOST_METHODS,
          hostCapabilities: CLI_HOST_CAPABILITIES,
        },
        onOpen(session) {
          return installRunCancelHandler(session);
        },
        onClose() {
          uninstallRunCancelHandler();
        },
        async onMessage(message, session) {
          if (isRecord(message) && message.type === "hello.ack") return;
          if (isRecord(message) && message.type === "run.event") {
            await handleEvent(message.event);
            return;
          }
          await handleEvent(
            message,
            (id, response) => session.send({ type: "response", id, ...(response as object) }),
            (sessionMessage) => session.send(sessionMessage),
          );
          if (result !== undefined || failure) session.close();
        },
      });
      uninstallRunCancelHandler();
    } else {
      await runtime.runEvents(started.runId, handleEvent);
    }
  } finally {
    presenter?.close();
    uninstallRunCancelHandler();
  }

  if (failure) throw failure;
  if (result === undefined) throw new Error(`Runtime operation ${operation} finished without a result`);
  return result;
}

let uninstallActiveRunCancelHandler: (() => void) | undefined;

function installRunCancelHandler(session: { send(message: unknown): void; close(code?: number, reason?: string): void }): void {
  uninstallRunCancelHandler();
  let cancelRequested = false;
  const onSigint = () => {
    if (cancelRequested) {
      session.close(1000, "Run cancelled by host");
      return;
    }
    cancelRequested = true;
    session.send({ type: "run.cancel", reason: "user" });
    process.once("SIGINT", onSigint);
  };
  process.once("SIGINT", onSigint);
  uninstallActiveRunCancelHandler = () => {
    process.off("SIGINT", onSigint);
    uninstallActiveRunCancelHandler = undefined;
  };
}

function uninstallRunCancelHandler(): void {
  uninstallActiveRunCancelHandler?.();
}

function resolveEngineOptions(invocation: CliInvocation): { projectDir: string; configPath: string; statePath?: string } {
  const paths = resolveCommandConfigPaths(invocation);
  const options = invocation.global;
  return {
    projectDir: paths.projectDir,
    configPath: paths.configPath,
    statePath: options.state ? resolve(process.cwd(), options.state) : undefined,
  };
}

function resolveCommandConfigPaths(invocation: CliInvocation): { projectDir: string; configPath: string } {
  const options = invocation.global;
  return resolveConfigPaths({ project: options.project, config: options.config });
}

type HostRequestEvent = {
  type: "host.request";
  requestId?: string;
  id?: string;
  method: string;
  params: unknown;
};

type HostCapabilityRequestEvent = {
  type: "host.capability.request";
  requestId?: string;
  id?: string;
  capability: string;
  params: unknown;
};

type HostRequestHandlingOptions = {
  quietOpen?: boolean;
};

class UnsupportedHostCapabilityError extends Error {
  constructor(capability: string) {
    super(
      `Host capability "${capability}" is not registered in this Rigkit CLI host. ` +
        `Install or enable a local host capability handler to use it from this host.`,
    );
    this.name = "UnsupportedHostCapabilityError";
  }
}

async function answerHostRequest(
  runtime: RuntimeClient,
  event: HostRequestEvent,
  options: HostRequestHandlingOptions = {},
): Promise<void> {
  if (!event.requestId) throw new Error(`Host request is missing requestId`);
  try {
    const result = await handleHostRequest(event.method, event.params, options);
    await runtime.control.hostResponse(event.requestId, { result });
  } catch (error) {
    await runtime.control.hostResponse(event.requestId, {
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function answerHostRequestOverSession(
  respond: (id: string, response: unknown) => void | Promise<void>,
  event: HostRequestEvent,
  options: HostRequestHandlingOptions = {},
): Promise<void> {
  const id = event.id ?? event.requestId;
  if (!id) throw new Error(`Host request is missing id`);
  try {
    const result = await handleHostRequest(event.method, event.params, options);
    await respond(id, { result });
  } catch (error) {
    await respond(id, {
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function answerHostCapabilityRequest(runtime: RuntimeClient, event: HostCapabilityRequestEvent): Promise<void> {
  const requestId = event.requestId ?? event.id;
  if (!requestId) throw new Error(`Host capability request is missing requestId`);
  try {
    const handled = await handleHostCapabilityRequest(event.capability, event.params);
    await runtime.control.hostResponse(requestId, { result: handled.result });
  } catch (error) {
    await runtime.control.hostResponse(requestId, {
      error: hostCapabilityError(error),
    });
  }
}

async function answerHostCapabilityRequestOverSession(
  send: (message: unknown) => void | Promise<void>,
  event: HostCapabilityRequestEvent,
): Promise<void> {
  const id = event.id ?? event.requestId;
  if (!id) throw new Error(`Host capability request is missing id`);
  try {
    const handled = await handleHostCapabilityRequest(event.capability, event.params);
    await send({ type: "response", id, result: handled.result });
    if (handled.closed) reportHostCapabilityClosed(send, id, handled.closed);
  } catch (error) {
    await send({
      type: "response",
      id,
      error: hostCapabilityError(error),
    });
  }
}

async function handleHostRequest(
  method: string,
  params: unknown,
  options: HostRequestHandlingOptions = {},
): Promise<unknown> {
  switch (method) {
    case "message.show":
      return showHostMessage(params);
    case "prompt.text":
      return await promptHostText(params);
    case "prompt.confirm":
      return await promptHostConfirm(params);
    case "prompt.select":
      return await promptHostSelect(params);
    case "open.external":
      return openHostExternal(params, options);
    case "host.command.run":
      return await runHostCommand(params);
    default:
      throw new Error(`Unsupported host method ${method}`);
  }
}

function hostRequestNeedsTerminal(event: HostRequestEvent): boolean {
  switch (event.method) {
    case "open.external":
      return false;
    case "host.command.run":
      return !isTrustedCaptureHostCommand(event.params);
    default:
      return true;
  }
}

function isTrustedCaptureHostCommand(params: unknown): boolean {
  return process.env.RIGKIT_TRUST_HOST_COMMANDS === "1" &&
    isRecord(params) &&
    params.mode !== "interactive";
}

type HandledHostCapability = {
  result: unknown;
  closed?: Promise<void>;
};

async function handleHostCapabilityRequest(capability: string, params: unknown): Promise<HandledHostCapability> {
  const handler = CLI_HOST_CAPABILITY_HANDLERS.get(capability);
  if (!handler) {
    throw new UnsupportedHostCapabilityError(capability);
  }
  return normalizeHostCapabilityResult(await handler.handle(params));
}

function normalizeHostCapabilityResult(value: unknown): HandledHostCapability {
  if (isRecord(value) && isPromiseLike(value.closed)) {
    const { closed, ...result } = value as Record<string, unknown> & { closed: PromiseLike<unknown> };
    return {
      result,
      closed: Promise.resolve(closed).then(() => undefined),
    };
  }
  return { result: value };
}

function reportHostCapabilityClosed(
  send: (message: unknown) => void | Promise<void>,
  id: string,
  closed: Promise<void>,
): void {
  void closed.then(
    () => send({ type: "host.capability.closed", id }),
    (error) => send({ type: "host.capability.closed", id, error: hostCapabilityError(error) }),
  ).catch(() => {});
}

function hostCapabilityError(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof UnsupportedHostCapabilityError ? "UNSUPPORTED_CAPABILITY" : "HOST_CAPABILITY_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function showHostMessage(params: unknown): null {
  const message = stringField(params, "message") ?? "";
  const level = stringField(params, "level") ?? "info";
  console.error(`${level}: ${message}`);
  return null;
}

async function promptHostText(params: unknown): Promise<string> {
  const message = stringField(params, "message") ?? "Enter value";
  const defaultValue = stringField(params, "defaultValue");
  if (!canPrompt()) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Host prompt requires an interactive terminal: ${message}`);
  }
  const answers = await inquirer.prompt<{ value: string }>([{
    type: "input",
    name: "value",
    message,
    default: defaultValue,
  }]);
  return answers.value || defaultValue || "";
}

async function promptHostConfirm(params: unknown): Promise<boolean> {
  const message = stringField(params, "message") ?? "Continue?";
  const defaultValue = booleanField(params, "defaultValue") ?? false;
  if (!canPrompt()) return defaultValue;
  const answers = await inquirer.prompt<{ value: boolean }>([{
    type: "confirm",
    name: "value",
    message,
    default: defaultValue,
  }]);
  return answers.value;
}

async function promptHostSelect(params: unknown): Promise<string> {
  const message = stringField(params, "message") ?? "Choose";
  const options = isRecord(params) && Array.isArray(params.options)
    ? params.options
      .filter(isRecord)
      .map((item) => ({
        value: typeof item.value === "string" ? item.value : "",
        label: typeof item.label === "string" ? item.label : typeof item.value === "string" ? item.value : "",
        hint: typeof item.description === "string" ? item.description : undefined,
      }))
      .filter((item) => item.value)
    : [];
  if (options.length === 0) throw new Error(`Host select prompt has no options`);
  const defaultValue = stringField(params, "defaultValue") ?? options[0]!.value;
  if (!canPrompt()) return defaultValue;
  const answers = await inquirer.prompt<{ value: string }>([{
    type: "select",
    name: "value",
    message,
    default: defaultValue,
    choices: options.map((option) => ({
      name: option.label,
      value: option.value,
      description: option.hint,
    })),
  }]);
  return answers.value;
}

function openHostExternal(params: unknown, options: HostRequestHandlingOptions = {}): null {
  const target = stringField(params, "target");
  if (!target) throw new Error(`open.external requires target`);
  if (!options.quietOpen) console.error(`open ${target}`);
  openExternalTarget(target);
  return null;
}

async function runHostCommand(params: unknown): Promise<{ exitCode: number; stdout: string | null; stderr: string | null }> {
  if (!isRecord(params) || !Array.isArray(params.argv) || params.argv.some((item) => typeof item !== "string")) {
    throw new Error(`host.command.run requires argv`);
  }
  const argv = params.argv as string[];
  if (argv.length === 0) throw new Error(`host.command.run argv must not be empty`);
  const mode = params.mode === "interactive" ? "interactive" : "capture";
  const cwd = stringField(params, "cwd");
  const reason = stringField(params, "reason");
  const env = isRecord(params.env)
    ? Object.fromEntries(Object.entries(params.env).filter(([, value]) => value === undefined || typeof value === "string")) as Record<string, string | undefined>
    : undefined;
  const stdin = params.stdin === null || typeof params.stdin === "string" ? params.stdin : undefined;

  if (process.env.RIGKIT_TRUST_HOST_COMMANDS !== "1") {
    const allowed = await confirmHostCommand({ argv, cwd, env, mode, reason });
    if (!allowed) throw new Error(`Host command denied`);
  }

  if (mode === "interactive") {
    const proc = Bun.spawn(argv, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdin: stdin === undefined || stdin === null ? "inherit" : "pipe",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (stdin !== undefined && stdin !== null) {
      const writer = proc.stdin;
      if (!writer) throw new Error(`Host command stdin is unavailable`);
      writer.write(stdin);
      writer.end();
    }
    return { exitCode: await proc.exited, stdout: null, stderr: null };
  }

  const proc = Bun.spawn(argv, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdin: stdin === undefined || stdin === null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && stdin !== null) {
    const writer = proc.stdin;
    if (!writer) throw new Error(`Host command stdin is unavailable`);
    writer.write(stdin);
    writer.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function confirmHostCommand(input: {
  argv: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  mode: "capture" | "interactive";
  reason?: string;
}): Promise<boolean> {
  if (!canPrompt()) {
    throw new Error(`Host command requires confirmation in an interactive terminal`);
  }

  console.error("");
  console.error(chalk.yellow("This Rigkit config is asking to run a command on this machine."));
  console.error(`${chalk.bold("Command:")} ${input.argv.map(shellDisplay).join(" ")}`);
  console.error(`${chalk.bold("Mode:")} ${input.mode}`);
  if (input.cwd) console.error(`${chalk.bold("cwd:")} ${input.cwd}`);
  if (input.env && Object.keys(input.env).length > 0) {
    console.error(`${chalk.bold("env:")} ${Object.keys(input.env).join(", ")}`);
  }
  if (input.reason) console.error(`${chalk.bold("Reason:")} ${input.reason}`);
  return await promptHostConfirm({ message: "Allow?", defaultValue: false });
}

function isHostRequestEvent(value: unknown): value is HostRequestEvent {
  return isRecord(value) &&
    value.type === "host.request" &&
    (typeof value.requestId === "string" || typeof value.id === "string") &&
    typeof value.method === "string";
}

function isHostCapabilityRequestEvent(value: unknown): value is HostCapabilityRequestEvent {
  return isRecord(value) &&
    value.type === "host.capability.request" &&
    (typeof value.requestId === "string" || typeof value.id === "string") &&
    typeof value.capability === "string";
}

function isWorkflowPlan(value: unknown): value is WorkflowPlan {
  return isRecord(value) &&
    typeof value.workflow === "string" &&
    typeof value.cachedNodeCount === "number" &&
    typeof value.nodeCount === "number" &&
    Array.isArray(value.nodes);
}

function isWorkspaceRecord(value: unknown): value is WorkspaceRecord {
  return isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.workflow === "string" &&
    isRecord(value.ctx);
}

function isDevMachineEvent(value: unknown): value is DevMachineEvent {
  return isRecord(value) &&
    typeof value.type === "string" &&
    !value.type.startsWith("run.") &&
    value.type !== "host.request" &&
    value.type !== "host.capability.request";
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === "boolean" ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value && typeof value.then === "function");
}

function shellDisplay(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function wantsJson(invocation: CliInvocation): boolean {
  return invocation.json;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printPlan(plan: WorkflowPlan): void {
  console.log(`${plan.workflow}: ${plan.cachedNodeCount}/${plan.nodeCount} nodes cached`);

  const rows = plan.nodes.map((node) => [
    String(node.index + 1),
    node.status,
    node.path,
    node.reason ?? "",
  ]);
  printTable(["#", "status", "node", "reason"], rows);
}

function printWorkspaces(
  workspaces: ReadonlyArray<Pick<WorkspaceRecord, "name" | "workflow" | "createdAt">>,
): void {
  if (workspaces.length === 0) {
    console.log("No workspaces.");
    return;
  }

  printTable(
    ["name", "workflow", "created"],
    workspaces.map((workspace) => [
      workspace.name,
      workspace.workflow,
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
    ["run", "workflow", "node", "snapshot", "created"],
    snapshots.map((snapshot) => [
      snapshot.id,
      snapshot.workflow,
      snapshot.nodePath,
      typeof snapshot.metadata.snapshotId === "string" ? snapshot.metadata.snapshotId : "",
      snapshot.createdAt,
    ]),
  );
}

function printConfig(info: EngineProjectInfo): void {
  const rows = [
    ["config", info.configPath],
    ["project", info.projectDir],
    ["state", info.statePath],
    ["workflow", info.workflow?.name ?? "(not loaded)"],
    ["providers", info.workflow?.providers.join(", ") ?? ""],
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
      console.error(`loaded ${event.workflow}`);
      return;
    case "plan.created":
      console.error(`plan ${event.workflow}: ${event.cachedNodeCount}/${event.nodeCount} cached`);
      return;
    case "node.cached":
      console.error(`node ${event.nodePath} cached`);
      return;
    case "vm.created":
      console.error(event.fromSnapshotId ? `vm ${event.vmId} from ${event.fromSnapshotId}` : `vm ${event.vmId} created`);
      return;
    case "node.started":
      console.error(`node ${event.nodePath}`);
      return;
    case "node.completed":
      console.error(`node ${event.nodePath} completed`);
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
    case "log.output":
      process.stderr.write(event.data);
      return;
    case "interaction.awaiting_user":
      console.error(`interaction ${event.label}`);
      console.error(`open ${event.url}`);
      return;
    case "interaction.completed":
      console.error(`interaction ${event.label} completed`);
      return;
    case "artifact.created":
      console.error(`artifact ${event.providerId}:${event.kind}`);
      return;
    case "workspace.ready":
      console.error(`workspace ${event.workspaceId} ready`);
      return;
    default:
      return;
  }
}
