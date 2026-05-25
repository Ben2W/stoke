#!/usr/bin/env bun
import { existsSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Command, CommanderError, Option } from "commander";
import inquirer from "inquirer";
import * as ui from "./ui.ts";
import {
  getOrStartRuntime,
  type RuntimeClient,
  type RuntimeControlCacheExplanation,
} from "@rigkit/runtime-client";
import {
  createFileProviderHostStorage,
  defaultProviderHostStorageDir,
  type DevMachineEvent,
  type WorkflowPlan,
  type SnapshotRecord,
  type WorkspaceRecord,
} from "@rigkit/engine";
import {
  cmuxHostCapabilities,
  type CmuxHostCapabilityHandler,
} from "@rigkit/provider-cmux/host";
import { DEFAULT_CONFIG_PATH, discoverProjectConfigs, resolveConfigPaths } from "./project.ts";
import { RIGKIT_CLI_VERSION } from "./version.ts";
import { initProject, type InitProjectResult } from "./init.ts";
import { openExternalTarget } from "./interaction.ts";
import { createRunPresenter, type RunPresenter } from "./run-presenter.ts";
import { createRunLogger, type RunLogger } from "./run-logger.ts";
import { maybePrintUpdateNotice } from "./update-check.ts";
import {
  evaluateVersionCompatibility,
  formatVersionCompatibilitySummary,
  renderVersionCompatibilityNotice,
} from "./version-compat.ts";
import {
  completeRig,
  formatCompletionItems,
  renderCompletionScript,
  resolveCompletionShell,
  type CompletionShell,
} from "./completion.ts";
import { generateWorkspaceName } from "./workspace-name.ts";

type GlobalOptions = {
  chdir?: string;
  state?: string;
  json: boolean;
};

type CliInvocation = {
  global: GlobalOptions;
  json: boolean;
};

type InitOptions = {
  install: boolean;
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
  workflow?: string;
};

type CacheListOptions = {
  workflow: string;
};

type CacheExplainOptions = {
  workflow: string;
  task?: string;
};

type CacheClearOptions = {
  workflow: string;
  local: boolean;
  global: boolean;
};

type PackageManager = "bun" | "pnpm" | "npm" | "skip";

type InitInstallResult = {
  packageManager: PackageManager;
  command?: string;
  skipped: boolean;
  reason?: "json" | "no-install" | "non-interactive";
};

type EngineProjectInfo = {
  projectDir: string;
  configPath: string;
  statePath: string;
  workflows: RuntimeWorkflowSummary[];
};

type RuntimeOperationManifest = {
  operations: RuntimeOperationDefinition[];
  workspaceOperations?: RuntimeOperationDefinition[];
};

type RuntimeWorkflowSummary = {
  name: string;
  providers: string[];
  nodes: string[];
  operations: string[];
  createsWorkspace: boolean;
  lastAppliedAt?: string;
  lastAppliedCachedNodeCount?: number;
  lastAppliedNodeCount?: number;
};

const checkedRuntimeCompatibility = new Set<string>();

type RuntimeOperationDefinition = {
  workflow: string;
  id: string;
  aliases?: string[];
  source?: "core" | "config";
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
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
};

type RuntimeOperationCliOption = NonNullable<NonNullable<RuntimeOperationDefinition["cli"]>["options"]>[number];

type JsonSchemaProperty = Record<string, unknown> & {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};

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

if (process.argv[2] === "__complete") {
  runCompletionEndpoint(process.argv.slice(3)).catch(handleCliError);
} else {
  runCli(process.argv).catch(handleCliError);
}

async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("rig")
    .description("Rigkit workflow CLI")
    .usage("[global options] <command> [args]")
    .version(RIGKIT_CLI_VERSION, "-v, --version", "Show Rigkit CLI version")
    .showHelpAfterError()
    .exitOverride()
    .argument("[command]")
    .addOption(new Option("--chdir <dir>", `Switch to a directory containing ${DEFAULT_CONFIG_PATH} before running the command`).hideHelp())
    .addOption(new Option("--state <file>", "Local runtime state database path").hideHelp())
    .addOption(new Option("--json", "Print machine-readable JSON where supported").hideHelp())
    .addHelpText("after", [
      "",
      "Global Options:",
      "  --chdir <dir>     Switch to a directory containing rigkit/index.ts before running the command",
      "  --state <file>    Local runtime state database path",
      "  --json            Print machine-readable JSON where supported",
      "",
    ].join("\n"))
    .action(async (command?: string) => {
      if (command) program.error(`unknown command '${command}'`);
      await runHelp(makeInvocation(rootOptions(program)));
    });

  program.hook("postAction", async (_thisCommand, actionCommand) => {
    await maybePrintUpdateNotice({
      commandName: actionCommand.name(),
      currentVersion: RIGKIT_CLI_VERSION,
      json: commandWantsJson(program, actionCommand),
    });
  });

  program
    .command("init")
    .description("Initialize a Rigkit project")
    .option("--package-manager <packageManager>", "Install with bun, pnpm, npm, or skip")
    .option("--no-install", "Write files without installing dependencies")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { packageManager?: string; install?: boolean; json?: boolean }) => {
      await runInit(makeInvocation(rootOptions(program), options.json), {
        install: options.install !== false,
        packageManager: parsePackageManagerOption(options.packageManager),
      });
    });

  for (const operation of ["plan", "apply"] as const) {
    program
      .command(`${operation} [args...]`)
      .description(operation === "plan" ? "Plan project workflow changes" : "Apply project workflow changes")
      .allowUnknownOption(true)
      .option("--all", "Run against every discovered project")
      .option("--discover", "Discover projects below the selected directory")
      .option("--json", "Print machine-readable JSON")
      .action(async (args: string[], options: { all?: boolean; discover?: boolean; json?: boolean }) => {
        await runProjectOperation(makeInvocation(rootOptions(program), options.json), operation, args ?? [], {
          all: Boolean(options.all),
          discover: Boolean(options.discover),
        });
      });
  }

  program
    .command("create [args...]")
    .description("Create a workspace")
    .allowUnknownOption(true)
    .option("--json", "Print machine-readable JSON")
    .action(async (args: string[], options: { json?: boolean }) => {
      await runProjectOperation(makeInvocation(rootOptions(program), options.json), "create", args ?? [], {
        all: false,
        discover: false,
      });
    });

  program
    .command("rm [workspace]")
    .description("Remove one workspace, several via multi-select, or every workspace")
    .option("-y, --yes", "Remove without confirmation")
    .option("--all", "Remove every workspace in this project")
    .option("--workflow <workflow>", "Workflow name")
    .option("--json", "Print machine-readable JSON")
    .action(async (workspace: string | undefined, options: { yes?: boolean; all?: boolean; workflow?: string; json?: boolean }) => {
      await runRemove(
        makeInvocation(rootOptions(program), options.json),
        {
          workspace,
          workflow: options.workflow,
          yes: Boolean(options.yes),
          all: Boolean(options.all),
        },
      );
    });

  program
    .command("run <workspace> <operation> [args...]")
    .description("Run a workspace operation")
    .allowUnknownOption(true)
    .option("--workflow <workflow>", "Workflow name")
    .option("--json", "Print machine-readable JSON")
    .action(async (
      workspace: string,
      operation: string,
      args: string[],
      options: { workflow?: string; json?: boolean },
    ) => {
      const parsed = parseRunCommandOptions(args ?? [], options);
      await runWorkspaceOperation(makeInvocation(rootOptions(program), parsed.json), workspace, operation, parsed.args, {
        workflow: parsed.workflow,
      });
    });

  program
    .command("ls [target]")
    .description("List project workspaces")
    .option("--workflow <workflow>", "Workflow name")
    .option("--json", "Print machine-readable JSON")
    .action(async (target: string | undefined, options: { workflow?: string; json?: boolean }) => {
      await runList(makeInvocation(rootOptions(program), options.json), { target, workflow: options.workflow });
    });

  const cache = program
    .command("cache <workflow> <action> [args...]")
    .description("Inspect and clear workflow cache")
    .allowUnknownOption(false)
    .option("--local", "Clear local cache entries")
    .option("--global", "Clear global cache fragments")
    .option("--all", "Invalidate every cached task in the workflow")
    .option("-y, --yes", "Skip confirmation when invalidating --all")
    .option("--json", "Print machine-readable JSON")
    .addHelpText("after", [
      "",
      "Actions:",
      "  ls                       List workflow cache entries",
      "  explain [task]           Explain why tasks are cached or pending",
      "  invalidate [task]        Mark cached task output stale",
      "  clear                    Delete workflow cache entries",
      "",
      "Examples:",
      "  rig cache dev explain",
      "  rig cache dev explain install-tooling",
      "  rig cache dev invalidate install-tooling",
      "  rig cache dev invalidate --all --yes",
      "",
    ].join("\n"))
    .action(async (
      workflow: string,
      action: string,
      args: string[],
      options: { local?: boolean; global?: boolean; all?: boolean; yes?: boolean; json?: boolean },
    ) => {
      await runCacheCommand(makeInvocation(rootOptions(program), options.json), {
        workflow,
        action,
        args: args ?? [],
        local: Boolean(options.local),
        global: Boolean(options.global),
        all: Boolean(options.all),
        yes: Boolean(options.yes),
      });
    });

  const providers = program
    .command("providers")
    .description("Manage provider-owned local state");

  const freestyleProvider = providers
    .command("freestyle")
    .description("Manage Freestyle provider local state");

  freestyleProvider
    .command("clear")
    .description("Clear Freestyle provider local auth and identity state")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await runProvidersFreestyleClear(makeInvocation(rootOptions(program), options.json));
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
    chdir?: string;
    state?: string;
    json?: boolean;
  }>();
  return {
    chdir: options.chdir,
    state: options.state,
    json: Boolean(options.json),
  };
}

function commandWantsJson(program: Command, actionCommand: Command): boolean {
  const options = actionCommand.opts<{ json?: boolean }>();
  return Boolean(rootOptions(program).json || options.json);
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

// Errors already rendered to the user (via printRunFailure or similar) carry
// this sentinel so handleCliError doesn't re-print the message a second time.
class DisplayedCliError extends Error {
  readonly displayed = true as const;
  constructor(message: string) {
    super(message);
    this.name = "DisplayedCliError";
  }
}

function handleCliError(error: unknown): void {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof DisplayedCliError) {
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runInit(invocation: CliInvocation, options: InitOptions): Promise<void> {
  if (wantsJson(invocation) && options.packageManager && options.packageManager !== "skip") {
    throw new Error(`rig init --json only supports --package-manager skip`);
  }

  if (!wantsJson(invocation)) {
    console.log(`${ui.bold("rig")} ${ui.dim("· initialize")}`);
    console.log("");
  }

  const result = initProject({
    projectDir: resolve(process.cwd(), invocation.global.chdir ?? "."),
  });
  const packageManager = await resolveInitPackageManager(invocation, options, result.projectDir);
  const install = await runPackageManagerInstall(result.projectDir, packageManager, wantsJson(invocation));

  if (wantsJson(invocation)) {
    printJson({ ...result, install });
    return;
  }

  printInitResult(result, install);
}

function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function resolveInitPackageManager(
  invocation: CliInvocation,
  options: InitOptions,
  projectDir: string,
): Promise<PackageManager> {
  if (!options.install) return "skip";
  if (wantsJson(invocation)) {
    return "skip";
  }
  if (options.packageManager) return options.packageManager;
  if (!canPrompt()) return "skip";
  return promptPackageManager(detectPackageManager(projectDir));
}

async function promptPackageManager(defaultValue: PackageManager): Promise<PackageManager> {
  const answers = await inquirer.prompt<{ packageManager: PackageManager }>([{
    type: "list",
    name: "packageManager",
    message: "Install dependencies with:",
    default: defaultValue,
    choices: [
      { name: "bun", value: "bun" },
      { name: "pnpm", value: "pnpm" },
      { name: "npm", value: "npm" },
      { name: "Skip for now", value: "skip" },
    ],
  }]);
  return answers.packageManager;
}

async function promptWorkspaceName(defaultValue: string): Promise<string> {
  const answers = await inquirer.prompt<{ name: string }>([{
    type: "input",
    name: "name",
    message: "Workspace name:",
    default: defaultValue,
    validate(value: string) {
      return validateWorkspaceName(value.trim());
    },
    filter: (value: string) => value.trim(),
  }]);
  return answers.name;
}

const workspaceNamePattern = /^(?!-)[A-Za-z0-9._-]+$/;

function validateWorkspaceName(value: string): true | string {
  if (!value) return "Workspace name is required.";
  if (!workspaceNamePattern.test(value)) {
    return 'Use only letters, numbers, ".", "_", and "-", and do not start with "-".';
  }
  return true;
}

function assertValidWorkspaceName(value: unknown): void {
  if (typeof value !== "string") throw new Error(`Workspace name must be a string`);
  const valid = validateWorkspaceName(value);
  if (valid !== true) throw new Error(`Invalid workspace name "${value}". ${valid}`);
}

async function defaultWorkspaceName(runtime: RuntimeClient): Promise<string> {
  const existingNames = await runtime.control.workspaces()
    .then((response) => response.workspaces.map((workspace) => workspace.name))
    .catch(() => []);
  return generateWorkspaceName(existingNames);
}

async function runPackageManagerInstall(
  projectDir: string,
  packageManager: PackageManager,
  jsonMode: boolean,
): Promise<InitInstallResult> {
  if (packageManager === "skip") {
    return {
      packageManager,
      skipped: true,
      reason: jsonMode ? "json" : canPrompt() ? "no-install" : "non-interactive",
    };
  }

  const command = packageManagerInstallCommand(packageManager);
  if (!jsonMode) {
    process.stderr.write(`${ui.accent(ui.sym.active)} ${ui.dim(`$ ${command.join(" ")}`)}\n`);
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
  console.log(`${ui.ok(ui.sym.ok)} ${ui.bold(result.name)} ${ui.dim("ready")}`);
  console.log("");

  console.log(ui.fileStatus(initStatus(result.created.config, false), shortPath(result.configPath)));
  console.log(ui.fileStatus(initStatus(result.created.packageJson, result.updated.packageJson), shortPath(result.packageJsonPath)));
  if (!install.skipped && install.command) {
    console.log(ui.fileStatus("created", install.command));
  }

  console.log("");
  console.log(ui.bold("Next"));
  const projectDir = displayProjectDir(result.projectDir);
  if (projectDir !== ".") {
    console.log(ui.hint(`cd ${projectDir}`));
  }
  if (install.skipped) {
    console.log(ui.hint(detectInstallCommand(result.packageJsonPath)));
  }
  console.log(ui.hint("rig plan"));
}

function parsePackageManagerOption(value: string | undefined): PackageManager | undefined {
  if (value === undefined) return undefined;
  if (isPackageManager(value)) return value;
  throw new Error(`Unsupported package manager "${value}". Use bun, pnpm, npm, or skip.`);
}

function isPackageManager(value: string): value is PackageManager {
  return value === "bun" || value === "pnpm" || value === "npm" || value === "skip";
}

function detectPackageManager(projectDir: string): PackageManager {
  if (existsSync(join(projectDir, "bun.lock")) || existsSync(join(projectDir, "bun.lockb"))) return "bun";
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectDir, "package-lock.json"))) return "npm";
  return "npm";
}

function detectInstallCommand(packageJsonPath: string): string {
  const projectDir = dirname(packageJsonPath);
  const packageManager = detectPackageManager(projectDir);
  return `${packageManager} install`;
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

function initStatus(created: boolean, updated: boolean): ui.FileStatus {
  if (created) return "created";
  if (updated) return "updated";
  return "kept";
}

function shortPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}

function displayProjectDir(projectDir: string): string {
  const path = relative(process.cwd(), projectDir);
  if (!path) return ".";
  return path && !path.startsWith("..") ? path : projectDir;
}

async function runProjectOperation(
  invocation: CliInvocation,
  requestedOperation: string,
  args: string[],
  options: RunOptions,
): Promise<void> {
  if (options.all || options.discover) {
    await runDiscoveredProjectOperation(invocation, requestedOperation, args, { all: options.all });
    return;
  }

  const runtime = await loadRuntime(invocation);
  const { operation, parsed, result } = await executeRuntimeOperation(
    invocation,
    runtime,
    requestedOperation,
    args,
  );

  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }

  await renderOperationResult(operation, result, parsed.hostOptions);
  if (operation.createsWorkspace && isWorkspaceRecord(result)) {
    await printWorkspaceNextSteps(runtime, result.name, result.workflow);
  }
  printInteractiveOutputGap(invocation);
}

function parseRunCommandOptions(
  args: string[],
  options: { workflow?: string; json?: boolean },
): { args: string[]; workflow?: string; json: boolean } {
  const operationArgs: string[] = [];
  let workflow = options.workflow;
  let json = Boolean(options.json);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") {
      operationArgs.push(...args.slice(index));
      break;
    }

    if (arg === "--workflow") {
      workflow = readOptionValue(args, ++index, "--workflow");
      continue;
    }
    if (arg.startsWith("--workflow=")) {
      workflow = arg.slice("--workflow=".length);
      if (!workflow) throw new Error("Missing value for --workflow");
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }

    operationArgs.push(arg);
  }

  return { args: operationArgs, workflow, json };
}

async function runWorkspaceOperation(
  invocation: CliInvocation,
  workspaceName: string,
  requestedOperation: string,
  args: string[],
  options: { workflow?: string },
): Promise<void> {
  const runtime = await loadRuntime(invocation);
  const workflow = await resolveWorkspaceWorkflow(invocation, runtime, workspaceName, options.workflow);
  const manifest = await readRuntimeOperations(runtime);
  const operation = (manifest.workspaceOperations ?? []).find((item) =>
    item.workflow === workflow && (item.id === requestedOperation || item.aliases?.includes(requestedOperation))
  );
  if (!operation) {
    throw new Error(`Workflow ${workflow} does not define a workspace operation named "${requestedOperation}".`);
  }

  const workspaces = await runtime.control.workspaces()
    .then((response) => response.workspaces as WorkspaceRecord[])
    .catch(() => []);
  if (!workspaces.some((workspace) => workspace.name === workspaceName && workspace.workflow === workflow)) {
    throw new Error(`Workflow ${workflow} does not have a workspace named "${workspaceName}".`);
  }

  const parsed = parseOperationArgs(operation, args, {
    allowMissingRequired: !wantsJson(invocation) && canPrompt(),
  });
  await promptMissingOperationInputs(invocation, runtime, operation, parsed);
  enforceRequiredOperationInputs(operation, parsed);
  enforceHostOnlyBooleanGuards(operation, parsed);

  const result = await runRuntimeOperation<unknown>(
    runtime,
    `${workspaceName}/${operation.id}`,
    { ...parsed.input, workflow },
    { renderEvents: !wantsJson(invocation) },
  );

  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }

  await renderOperationResult(operation, result, parsed.hostOptions);
  printInteractiveOutputGap(invocation);
}

async function runRemove(
  invocation: CliInvocation,
  options: { workspace?: string; workflow?: string; yes: boolean; all: boolean },
): Promise<void> {
  if (options.workspace && options.all) {
    throw new Error(`rig rm accepts either a workspace name or --all, not both`);
  }

  if (options.workspace) {
    await runRemoveWorkspaceOperation(invocation, options.workspace, { workflow: options.workflow, yes: options.yes });
    return;
  }

  const runtime = await loadRuntime(invocation);
  if (options.workflow) {
    assertKnownWorkflow(options.workflow, await readRuntimeWorkflows(runtime));
  }
  const workspaces = await runtime.control.workspaces()
    .then((response) => response.workspaces as WorkspaceRecord[])
    .catch(() => []);
  if (workspaces.length === 0) {
    if (wantsJson(invocation)) {
      printJson({ removed: [] });
      return;
    }
    console.log(ui.dim("no workspaces"));
    return;
  }

  let targets: string[];
  if (options.all) {
    if (!options.yes && !wantsJson(invocation) && canPrompt()) {
      const confirmed = await promptHostConfirm({
        message: `Remove all ${workspaces.length} workspaces?`,
        defaultValue: false,
      });
      if (!confirmed) throw new Error("Remove cancelled");
    } else if (!options.yes && !canPrompt()) {
      throw new Error(`rig rm --all needs --yes when not running in an interactive terminal`);
    }
    targets = workspaces
      .filter((workspace) => options.workflow === undefined || workspace.workflow === options.workflow)
      .map((workspace) => `${workspace.workflow}/${workspace.name}`);
  } else {
    if (wantsJson(invocation) || !canPrompt()) {
      throw new Error(`rig rm needs a workspace name or --all when not running in an interactive terminal`);
    }
    targets = await promptWorkspaceRemoveSelection(workspaces, options.workflow);
    if (targets.length === 0) throw new Error("Nothing selected");
  }

  const removed: string[] = [];
  for (const target of targets) {
    const slash = target.indexOf("/");
    const workflow = slash > 0 ? target.slice(0, slash) : options.workflow;
    const name = slash > 0 ? target.slice(slash + 1) : target;
    await runRemoveWorkspaceOperation(invocation, name, { workflow, yes: true });
    removed.push(workflow ? `${workflow}/${name}` : name);
  }
  if (wantsJson(invocation)) printJson({ removed });
}

async function promptWorkspaceRemoveSelection(
  workspaces: ReadonlyArray<Pick<WorkspaceRecord, "name" | "workflow">>,
  workflow?: string,
): Promise<string[]> {
  const candidates = workspaces.filter((workspace) => workflow === undefined || workspace.workflow === workflow);
  const answers = await inquirer.prompt<{ names: string[] }>([{
    type: "checkbox",
    name: "names",
    message: "Select workspaces to remove",
    choices: candidates.map((workspace) => ({
      name: workspace.workflow ? `${workspace.workflow}/${workspace.name}` : workspace.name,
      value: `${workspace.workflow}/${workspace.name}`,
      description: workspace.workflow ? `workflow ${workspace.workflow}` : undefined,
    })),
  }]);
  return answers.names;
}

async function runRemoveWorkspaceOperation(
  invocation: CliInvocation,
  workspaceName: string,
  options: { workflow?: string; yes: boolean },
): Promise<void> {
  const runtime = await loadRuntime(invocation);
  const manifest = await readRuntimeOperations(runtime);
  const workflow = await resolveWorkspaceWorkflow(invocation, runtime, workspaceName, options.workflow);
  const operation = (manifest.workspaceOperations ?? []).find((item) => item.id === "remove" && item.workflow === workflow);
  if (!operation) {
    throw new Error(`Workflow ${workflow} does not define a removable workspace.`);
  }

  const workspaces = await runtime.control.workspaces()
    .then((response) => response.workspaces as WorkspaceRecord[])
    .catch(() => []);
  if (!workspaces.some((workspace) => workspace.name === workspaceName && workspace.workflow === workflow)) {
    throw new Error(`Workflow ${workflow} does not have a workspace named "${workspaceName}".`);
  }

  if (!options.yes && !wantsJson(invocation) && canPrompt()) {
    const confirmed = await promptHostConfirm({
      message: `Remove workspace ${workspaceName}?`,
      defaultValue: false,
    });
    if (!confirmed) throw new Error("Remove cancelled");
    options = { yes: true };
  }

  const parsed = parseOperationArgs(operation, options.yes ? ["--yes"] : []);
  enforceHostOnlyBooleanGuards(operation, parsed);

  const result = await runRuntimeOperation<unknown>(
    runtime,
    `${workspaceName}/remove`,
    { ...parsed.input, workflow },
    { renderEvents: !wantsJson(invocation) },
  );

  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }

  await renderOperationResult(operation, result, parsed.hostOptions);
  printInteractiveOutputGap(invocation);
}

async function runDiscoveredProjectOperation(
  invocation: CliInvocation,
  requestedOperation: string,
  args: string[],
  options: { all: boolean },
): Promise<void> {
  const projects = discoverProjectConfigs({
    chdir: invocation.global.chdir,
  });
  if (projects.length === 0) {
    throw new Error("No Rigkit projects found.");
  }
  if (!options.all && projects.length > 1) {
    throw new Error([
      "Multiple Rigkit projects found.",
      "Use `rig projects` to list candidates, pass --chdir to select one, or pass --all to run every discovered project.",
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
      statePath: invocation.global.state ? resolveGlobalPath(invocation, invocation.global.state) : undefined,
    });
    await checkRuntimeCompatibility(invocation, runtime);
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
        console.log(ui.bold(displayProjectDir(project.projectDir)));
      }
      await renderOperationResult(operation, result, parsed.hostOptions);
      printInteractiveOutputGap(invocation);
    }
  }

  if (wantsJson(invocation)) {
    printJson({ projects: results });
  }
}

async function runProjects(invocation: CliInvocation): Promise<void> {
  const projects = discoverProjectConfigs({
    chdir: invocation.global.chdir,
  });
  if (wantsJson(invocation)) {
    printJson({ projects });
    return;
  }
  if (projects.length === 0) {
    console.log(ui.dim("no Rigkit projects found"));
    return;
  }
  const rows = projects.map((project) => [
    { text: project.projectDir, style: ui.bold },
    { text: project.configPath, style: ui.dim },
  ]);
  console.log(ui.columns(["project", "config"], rows));
}

async function runList(invocation: CliInvocation, options: ListOptions): Promise<void> {
  const target = normalizeListTarget(options.target);
  const runtime = await loadRuntime(invocation);

  if (target === "workspaces") {
    const workflows = await readWorkflowOverview(invocation, runtime, options.workflow);
    if (wantsJson(invocation)) {
      printJson({ workflows });
      return;
    }
    printWorkflowWorkspaces(workflows);
    return;
  }

  if (target === "snapshots") {
    const { snapshots } = await runtime.control.snapshots();
    const filtered = options.workflow
      ? (snapshots as SnapshotRecord[]).filter((snapshot) => snapshot.workflow === options.workflow)
      : snapshots as SnapshotRecord[];
    if (wantsJson(invocation)) {
      printJson({ snapshots: filtered });
      return;
    }
    printSnapshots(filtered);
    return;
  }

  const project = await readRuntimeProject(runtime);
  if (wantsJson(invocation)) {
    printJson(project);
    return;
  }
  printConfig(project);
}

async function runCacheCommand(
  invocation: CliInvocation,
  input: {
    workflow: string;
    action: string;
    args: string[];
    local: boolean;
    global: boolean;
    all: boolean;
    yes: boolean;
  },
): Promise<void> {
  switch (input.action) {
    case "ls":
      assertNoCacheArgs(input.action, input.args);
      await runCacheList(invocation, { workflow: input.workflow });
      return;
    case "explain":
      assertAtMostOneCacheArg(input.action, input.args);
      await runCacheExplain(invocation, {
        workflow: input.workflow,
        task: input.args[0],
      });
      return;
    case "clear":
      assertNoCacheArgs(input.action, input.args);
      if (input.all) {
        throw new Error(`rig cache <workflow> clear does not accept --all; omit flags to clear local and global cache for the workflow`);
      }
      await runCacheClear(invocation, {
        workflow: input.workflow,
        local: input.local,
        global: input.global,
      });
      return;
    case "invalidate":
      assertAtMostOneCacheArg(input.action, input.args);
      await runCacheInvalidate(invocation, {
        workflow: input.workflow,
        task: input.args[0],
        all: input.all,
        yes: input.yes,
      });
      return;
    default:
      throw new Error(`Unknown cache action ${input.action}. Expected ls, explain, clear, or invalidate.`);
  }
}

function assertNoCacheArgs(action: string, args: readonly string[]): void {
  if (args.length > 0) throw new Error(`rig cache <workflow> ${action} does not accept positional arguments`);
}

function assertAtMostOneCacheArg(action: string, args: readonly string[]): void {
  if (args.length > 1) throw new Error(`rig cache <workflow> ${action} accepts at most one task`);
}

async function runCacheList(invocation: CliInvocation, options: CacheListOptions): Promise<void> {
  const runtime = await loadRuntime(invocation);
  const cache = await runtime.control.cache({ workflow: options.workflow });
  if (wantsJson(invocation)) {
    printJson(cache);
    return;
  }
  printCacheEntries(cache.entries);
}

async function runCacheExplain(invocation: CliInvocation, options: CacheExplainOptions): Promise<void> {
  const runtime = await loadRuntime(invocation);
  const explanation = await runtime.control.explainCache({
    workflow: options.workflow,
    ...(options.task ? { task: options.task } : {}),
  });
  if (wantsJson(invocation)) {
    printJson(explanation);
    return;
  }
  printCacheExplanations(explanation.explanations);
}

async function runCacheClear(invocation: CliInvocation, options: CacheClearOptions): Promise<void> {
  if (options.local && options.global) {
    throw new Error(`Choose --local or --global, not both`);
  }

  const scope = options.local ? "local" : options.global ? "global" : "all";
  const runtime = await loadRuntime(invocation);
  const result = await runtime.control.clearCache({ workflow: options.workflow, scope });
  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }
  console.log(`Cleared ${result.deleted} cache ${result.deleted === 1 ? "entry" : "entries"}.`);
}

async function runProvidersFreestyleClear(invocation: CliInvocation): Promise<void> {
  const providerId = "freestyle";
  const storageRoot = defaultProviderHostStorageDir();
  const storage = createFileProviderHostStorage({ providerId, rootDir: storageRoot });
  const keys = storage.entries().map((entry) => entry.key);
  for (const key of keys) storage.delete(key);

  const result = {
    ok: true,
    providerId,
    deleted: keys.length,
    storageRoot,
  };

  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }

  if (keys.length === 0) {
    console.log("No Freestyle provider local state to clear.");
    return;
  }
  console.log(`Cleared ${keys.length} Freestyle provider ${keys.length === 1 ? "entry" : "entries"}.`);
}

type CacheInvalidateOptions = {
  workflow: string;
  task?: string;
  all: boolean;
  yes: boolean;
};

async function runCacheInvalidate(invocation: CliInvocation, options: CacheInvalidateOptions): Promise<void> {
  if (options.task && options.all) {
    throw new Error(`rig cache <workflow> invalidate accepts either a task or --all, not both`);
  }

  const runtime = await loadRuntime(invocation);
  let targets: string[] = [];

  if (options.task) {
    targets = [options.task];
  } else if (options.all) {
    if (!options.yes && !wantsJson(invocation) && canPrompt()) {
      const confirmed = await promptHostConfirm({
        message: `Invalidate every cached task in workflow ${options.workflow}?`,
        defaultValue: false,
      });
      if (!confirmed) throw new Error("Invalidate cancelled");
    } else if (!options.yes && !canPrompt()) {
      throw new Error(`rig cache <workflow> invalidate --all needs --yes when not running in an interactive terminal`);
    }
    targets = []; // empty = engine invalidates everything for the workflow
  } else {
    // Interactive: multi-select among currently-valid cache entries.
    const cache = await runtime.control.cache({ workflow: options.workflow });
    const candidates = cache.entries
      .filter((entry) => !entry.invalidated)
      .map((entry) => ({
        path: entry.displayPath || entry.nodePath || entry.nodeName,
        workflow: entry.workflow,
        scope: entry.scope,
      }));
    if (candidates.length === 0) {
      if (wantsJson(invocation)) {
        printJson({ ok: true, invalidated: 0 });
        return;
      }
      console.log(ui.dim("no valid cache entries to invalidate"));
      return;
    }
    if (wantsJson(invocation) || !canPrompt()) {
      throw new Error(`rig cache <workflow> invalidate needs a task name or --all when not running in an interactive terminal`);
    }
    const picked = await promptCacheInvalidateSelection(candidates);
    if (picked.length === 0) throw new Error("Nothing selected");
    targets = picked;
  }

  const result = await runtime.control.invalidateCache({
    workflow: options.workflow,
    nodePaths: targets,
  });
  if (wantsJson(invocation)) {
    printJson(result);
    return;
  }
  if (result.invalidated === 0) {
    console.log(ui.dim("no cache entries invalidated"));
    return;
  }
  console.log(
    `${ui.ok(ui.sym.ok)} invalidated ${result.invalidated} cache ${result.invalidated === 1 ? "entry" : "entries"}`,
  );
}

async function promptCacheInvalidateSelection(
  candidates: Array<{ path: string; workflow: string; scope: "local" | "global" }>,
): Promise<string[]> {
  const answers = await inquirer.prompt<{ paths: string[] }>([{
    type: "checkbox",
    name: "paths",
    message: "Select tasks to invalidate",
    choices: candidates.map((c) => ({
      name: c.path,
      value: c.path,
      description: c.workflow ? `${c.scope} cache, workflow ${c.workflow}` : `${c.scope} cache`,
    })),
  }]);
  return answers.paths;
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

  const parsed = await parseOperationArgsWithPrompts(invocation, runtime, operation, args);
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
  const operation = manifest.operations.find((operation) =>
    operation.id === requestedOperation || operation.aliases?.includes(requestedOperation)
  );
  return operation ? { operation, runOperation: operation.id } : undefined;
}

async function parseOperationArgsWithPrompts(
  invocation: CliInvocation,
  runtime: RuntimeClient,
  operation: RuntimeOperationDefinition,
  args: string[],
): Promise<ParsedOperationInput> {
  const parsed = parseOperationArgs(operation, args, {
    allowMissingRequired: !wantsJson(invocation) && canPrompt(),
  });

  if (operationRequiresWorkflowSelection(operation)) {
    parsed.input.workflow = await resolveOperationWorkflow(invocation, runtime, operation, parsed.input.workflow);
  }

  if (
    operation.createsWorkspace &&
    parsed.input.name === undefined &&
    !wantsJson(invocation) &&
    canPrompt()
  ) {
    parsed.input.name = await promptWorkspaceName(await defaultWorkspaceName(runtime));
  }
  if (operation.createsWorkspace && parsed.input.name !== undefined) {
    assertValidWorkspaceName(parsed.input.name);
  }

  await promptMissingOperationInputs(invocation, runtime, operation, parsed);
  enforceRequiredOperationInputs(operation, parsed);
  return parsed;
}

async function promptMissingOperationInputs(
  invocation: CliInvocation,
  runtime: RuntimeClient,
  operation: RuntimeOperationDefinition,
  parsed: ParsedOperationInput,
): Promise<void> {
  if (wantsJson(invocation) || !canPrompt()) return;

  const required = new Set(operation.inputSchema?.required ?? []);
  if (required.size === 0) return;

  for (const [name, property] of orderedOperationInputProperties(operation)) {
    if (!required.has(name)) continue;
    if (parsed.input[name] !== undefined || parsed.hostOptions[name] !== undefined) continue;

    const value = await promptOperationInput(runtime, operation, name, property);
    if (value !== undefined && value !== "") parsed.input[name] = value;
  }
}

function orderedOperationInputProperties(
  operation: RuntimeOperationDefinition,
): Array<[string, JsonSchemaProperty]> {
  const properties = operation.inputSchema?.properties ?? {};
  const cli = inferCliMetadata(operation);
  const order = [
    ...[...cli.positionals].sort((left, right) => left.index - right.index).map((item) => item.name),
    ...cli.options.map((item) => item.name),
  ];
  const seen = new Set<string>();
  const result: Array<[string, JsonSchemaProperty]> = [];

  for (const name of order) {
    const property = properties[name];
    if (!property || seen.has(name)) continue;
    seen.add(name);
    result.push([name, property]);
  }

  for (const entry of Object.entries(properties)) {
    if (seen.has(entry[0])) continue;
    result.push(entry);
  }

  return result;
}

async function promptOperationInput(
  runtime: RuntimeClient,
  operation: RuntimeOperationDefinition,
  name: string,
  property: JsonSchemaProperty,
): Promise<unknown> {
  const enumValues = Array.isArray(property.enum) ? property.enum : [];
  if (enumValues.length > 0) {
    const answers = await inquirer.prompt<{ value: unknown }>([{
      type: "select",
      name: "value",
      message: inputPromptMessage(name, property),
      default: property.default,
      choices: enumValues.map((value) => ({
        name: String(value),
        value,
      })),
    }]);
    return answers.value;
  }

  if (isWorkspaceInputProperty(property)) {
    const response = await runtime.control.workspaces();
    const workspaces = (response.workspaces as WorkspaceRecord[])
      .filter((workspace) => !operation.workflow || workspace.workflow === operation.workflow);
    if (workspaces.length === 0) throw new Error(`No workspaces are available for ${operation.id}`);
    const answers = await inquirer.prompt<{ value: string }>([{
      type: "select",
      name: "value",
      message: inputPromptMessage(name, property),
      choices: workspaces.map((workspace) => ({
        name: workspace.name,
        value: workspace.name,
        description: workspace.workflow,
      })),
    }]);
    return answers.value;
  }

  if (property.type === "boolean") {
    const answers = await inquirer.prompt<{ value: boolean }>([{
      type: "confirm",
      name: "value",
      message: inputPromptMessage(name, property),
      default: typeof property.default === "boolean" ? property.default : false,
    }]);
    return answers.value;
  }

  const answers = await inquirer.prompt<{ value: string }>([{
    type: "input",
    name: "value",
    message: inputPromptMessage(name, property),
    default: typeof property.default === "string" || typeof property.default === "number"
      ? String(property.default)
      : undefined,
    validate: (value: string) => {
      if (!value) return `${name} is required`;
      if (property.type === "number" && !Number.isFinite(Number(value))) return `${name} must be a number`;
      return true;
    },
  }]);
  return property.type === "number" ? Number(answers.value) : answers.value;
}

function inputPromptMessage(name: string, property: JsonSchemaProperty): string {
  return property.description ? `${name} (${property.description})` : name;
}

function isWorkspaceInputProperty(property: JsonSchemaProperty): boolean {
  const input = property["x-rigkit-input"];
  return Boolean(input && typeof input === "object" && (input as { kind?: unknown }).kind === "workspace");
}

function operationRequiresWorkflowSelection(operation: RuntimeOperationDefinition): boolean {
  return operation.source === "core" &&
    (operation.cli?.options?.some((option) => option.name === "workflow") ??
      Boolean(operation.inputSchema?.properties?.workflow));
}

async function resolveOperationWorkflow(
  invocation: CliInvocation,
  runtime: RuntimeClient,
  operation: RuntimeOperationDefinition,
  value: unknown,
): Promise<string> {
  const workflows = await readRuntimeWorkflows(runtime);
  if (typeof value === "string" && value.trim()) {
    assertKnownWorkflow(value, workflows);
    return value;
  }

  if (wantsJson(invocation) || !canPrompt()) {
    throw new Error(`${operation.id} requires --workflow. Available workflows: ${formatWorkflowNames(workflows)}`);
  }
  return await promptWorkflowSelection(workflows);
}

async function resolveWorkspaceWorkflow(
  invocation: CliInvocation,
  runtime: RuntimeClient,
  workspaceName: string,
  requestedWorkflow: string | undefined,
): Promise<string> {
  const workflows = await readRuntimeWorkflows(runtime);
  if (requestedWorkflow) {
    assertKnownWorkflow(requestedWorkflow, workflows);
    return requestedWorkflow;
  }

  const { workspaces } = await runtime.control.workspaces();
  const matches = (workspaces as WorkspaceRecord[]).filter((workspace) => workspace.name === workspaceName);
  if (matches.length === 1) return matches[0]!.workflow;
  if (matches.length === 0) throw new Error(`This project does not have a workspace named "${workspaceName}".`);

  if (wantsJson(invocation) || !canPrompt()) {
    throw new Error(`Workspace "${workspaceName}" exists in multiple workflows: ${matches.map((item) => item.workflow).join(", ")}. Pass --workflow.`);
  }
  return await promptWorkflowSelection(
    workflows.filter((workflow) => matches.some((workspace) => workspace.workflow === workflow.name)),
    `Workspace "${workspaceName}" exists in multiple workflows. Select workflow`,
  );
}

function assertKnownWorkflow(name: string, workflows: RuntimeWorkflowSummary[]): void {
  if (workflows.some((workflow) => workflow.name === name)) return;
  throw new Error(`Unknown workflow ${name}. Available workflows: ${formatWorkflowNames(workflows)}`);
}

function formatWorkflowNames(workflows: RuntimeWorkflowSummary[]): string {
  return workflows.length > 0 ? workflows.map((workflow) => workflow.name).join(", ") : "(none)";
}

async function promptWorkflowSelection(workflows: RuntimeWorkflowSummary[], message = "Select workflow"): Promise<string> {
  if (workflows.length === 0) throw new Error("This project does not define any workflows.");
  const answers = await inquirer.prompt<{ workflow: string }>([{
    type: "select",
    name: "workflow",
    message,
    choices: workflows.map((workflow) => ({
      name: workflow.name,
      value: workflow.name,
      description: workflow.createsWorkspace ? "creates workspaces" : "workflow",
    })),
  }]);
  return answers.workflow;
}

function parseOperationArgs(
  operation: RuntimeOperationDefinition,
  args: string[],
  options: { allowMissingRequired?: boolean } = {},
): ParsedOperationInput {
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

  if (!options.allowMissingRequired) enforceRequiredOperationInputs(operation, { input, hostOptions });

  return { input, hostOptions };
}

function enforceRequiredOperationInputs(
  operation: RuntimeOperationDefinition,
  parsed: ParsedOperationInput,
): void {
  const cli = inferCliMetadata(operation);
  for (const option of cli.options ?? []) {
    if (option.required && parsed.input[option.name] === undefined && parsed.hostOptions[option.name] === undefined) {
      throw new Error(`Operation ${operation.id} requires ${option.flag}`);
    }
  }

  for (const name of operation.inputSchema?.required ?? []) {
    if (parsed.input[name] === undefined) {
      throw new Error(`Operation ${operation.id} requires ${name}`);
    }
  }
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
    // Only emit the bareword name when stdout is piped, so scripts can do
    // `name=$(rig create)` while TTY users aren't shown a redundant line.
    if (!process.stdout.isTTY) console.log(result.name);
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
    if (!process.stdout.isTTY) console.log(result.name);
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
    console.log(ui.kvList([
      ["cli", diagnostics.cliVersion],
      ["binary", diagnostics.binary ?? ""],
      ["node", diagnostics.node],
      ["bun", diagnostics.bun ?? ""],
    ]));
    return;
  }

  const runtime = await loadRuntime(invocation, { checkCompatibility: false });
  const [health, runtimeInfo, project] = await Promise.all([
    runtime.control.health(),
    runtime.control.runtime(),
    readRuntimeProject(runtime),
  ]);
  const compatibility = evaluateVersionCompatibility({
    cliVersion: RIGKIT_CLI_VERSION,
    runtimeVersion: runtimeInfo.runtimeVersion,
    engineVersion: runtimeInfo.engineVersion,
  });
  const diagnostics = {
    cliVersion: RIGKIT_CLI_VERSION,
    compatibility,
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

  console.log(ui.kvList([
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
    ["compatibility", formatVersionCompatibilitySummary(compatibility)],
    ["state", project.statePath ?? ""],
    ["expires", health.expiresAt ?? runtime.handle.expiresAt ?? ""],
  ]));
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
        { name: "plan", description: "Plan project workflow changes" },
        { name: "apply", description: "Apply project workflow changes" },
        { name: "create", description: "Create a workspace" },
        { name: "rm", description: "Remove a workspace" },
        { name: "run", description: "Run a workspace operation" },
        { name: "ls", description: "List project workspaces" },
        { name: "cache", description: "Inspect and clear workflow cache" },
        { name: "providers", description: "Manage provider-owned local state" },
        { name: "projects", description: "Discover Rigkit projects below the current directory" },
        { name: "doctor", description: "Show Rigkit runtime diagnostics" },
        { name: "version", description: "Show Rigkit CLI version" },
        { name: "completion", description: "Generate shell completion script" },
      ],
    });
    return;
  }
  const cmd = (name: string, description: string): string =>
    `  ${ui.bold(name.padEnd(10))}  ${description}`;
  const opt = (flag: string, description: string): string =>
    `  ${ui.bold(flag.padEnd(17))}  ${description}`;

  console.log([
    `${ui.bold("rig")} ${ui.dim(RIGKIT_CLI_VERSION)}`,
    "",
    ui.dim("Usage:"),
    `  ${ui.accent(ui.sym.prompt)} rig [global options] <command> [args]`,
    "",
    ui.dim("Commands:"),
    cmd("help",       "Show Rigkit CLI help"),
    cmd("init",       "Initialize a Rigkit project"),
    cmd("plan",       "Plan project workflow changes"),
    cmd("apply",      "Apply project workflow changes"),
    cmd("create",     "Create a workspace"),
    cmd("rm",         "Remove a workspace"),
    cmd("run",        "Run a workspace operation"),
    cmd("ls",         "List project workspaces"),
    cmd("cache",      "Inspect and clear workflow cache"),
    cmd("providers",  "Manage provider-owned local state"),
    cmd("projects",   "Discover Rigkit projects below the current directory"),
    cmd("doctor",     "Show Rigkit runtime diagnostics"),
    cmd("version",    "Show Rigkit CLI version"),
    cmd("completion", "Generate shell completion script"),
    "",
    ui.dim("Options:"),
    opt("--chdir <dir>",   "Switch to a directory containing rigkit/index.ts before running the command"),
    opt("--state <file>",  "Local runtime state database path"),
    opt("--json",          "Print machine-readable JSON where supported"),
  ].join("\n"));
}

async function loadRuntime(
  invocation: CliInvocation,
  options: { checkCompatibility?: boolean } = {},
): Promise<RuntimeClient> {
  const engineOptions = resolveEngineOptions(invocation);
  const runtime = await getOrStartRuntime(engineOptions);
  if (options.checkCompatibility !== false) {
    await checkRuntimeCompatibility(invocation, runtime);
  }
  return runtime;
}

async function checkRuntimeCompatibility(invocation: CliInvocation, runtime: RuntimeClient): Promise<void> {
  const runtimeKey = runtime.handle.url;
  if (checkedRuntimeCompatibility.has(runtimeKey)) return;

  const runtimeInfo = await readRuntimeCompatibilityMetadata(runtime);
  if (!runtimeInfo) {
    checkedRuntimeCompatibility.add(runtimeKey);
    return;
  }

  const compatibility = evaluateVersionCompatibility({
    cliVersion: RIGKIT_CLI_VERSION,
    runtimeVersion: runtimeInfo.runtimeVersion,
    engineVersion: runtimeInfo.engineVersion,
  });
  if (compatibility.severity === "ok") {
    checkedRuntimeCompatibility.add(runtimeKey);
    return;
  }

  const notice = renderVersionCompatibilityNotice(compatibility);
  if (compatibility.severity === "error") {
    throw new Error(notice.trimEnd());
  }

  checkedRuntimeCompatibility.add(runtimeKey);
  if (!wantsJson(invocation)) {
    process.stderr.write(notice);
  }
}

async function readRuntimeCompatibilityMetadata(
  runtime: RuntimeClient,
): Promise<{ runtimeVersion: string; engineVersion: string } | undefined> {
  try {
    return await runtime.control.runtime();
  } catch {
    if (runtime.handle.runtimeVersion && runtime.handle.engineVersion) {
      return {
        runtimeVersion: runtime.handle.runtimeVersion,
        engineVersion: runtime.handle.engineVersion,
      };
    }
    return undefined;
  }
}

async function readRuntimeProject(runtime: RuntimeClient): Promise<EngineProjectInfo> {
  return await runtime.control.project() as EngineProjectInfo;
}

async function readRuntimeOperations(runtime: RuntimeClient): Promise<RuntimeOperationManifest> {
  return await runtime.control.operations() as unknown as RuntimeOperationManifest;
}

async function readRuntimeWorkflows(runtime: RuntimeClient): Promise<RuntimeWorkflowSummary[]> {
  const response = await runtime.control.workflows() as unknown as { workflows: RuntimeWorkflowSummary[] };
  return response.workflows;
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
  const logger: RunLogger | undefined = createRunLogger({
    projectDir: runtime.handle.projectDir,
    operation,
    daemonStderrPath: runtime.paths.runtimeLogPath,
  });
  if (logger) {
    logger.append({ type: "run.started", runId: started.runId, operation, input });
  }
  let result: T | undefined;
  let failure: Error | undefined;
  let failureCode: string | undefined;
  let activeNodePath: string | undefined;

  const handleEvent = async (
    event: unknown,
    respond?: (id: string, response: unknown) => void | Promise<void>,
    sendSession?: (message: unknown) => void | Promise<void>,
  ) => {
    logger?.append(event);
    if (isRecord(event)) {
      if (event.type === "node.started" && typeof event.nodePath === "string") {
        activeNodePath = event.nodePath;
      }
      if (event.type === "node.completed" && event.nodePath === activeNodePath) {
        activeNodePath = undefined;
      }
    }
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
      const suspendPresenter = hostCapabilityNeedsTerminal(event);
      const logger = createHostCapabilityLogger(event, presenter);
      if (suspendPresenter) presenter?.pause();
      try {
        if (sendSession) {
          await answerHostCapabilityRequestOverSession(sendSession, event, { logger });
        } else if (respond) {
          await answerHostCapabilityRequestOverSession((message) => {
            if (isRecord(message) && message.type === "response") {
              const id = typeof message.id === "string" ? message.id : undefined;
              if (id) return respond(id, "error" in message ? { error: message.error } : { result: message.result });
            }
            throw new Error(`Session response channel cannot send ${String(isRecord(message) ? message.type : typeof message)}`);
          }, event, { logger });
        } else {
          await answerHostCapabilityRequest(runtime, event, { logger });
        }
      } finally {
        if (suspendPresenter) presenter?.resume();
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
      failureCode = isRecord(event.error) && typeof event.error.code === "string"
        ? event.error.code
        : undefined;
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
    if (logger) {
      logger.finish({
        status: failure ? "failed" : "completed",
        error: failure,
        result,
      });
      logger.close();
    }
    uninstallRunCancelHandler();
  }

  if (failure) {
    printRunFailure({
      operation,
      node: activeNodePath,
      code: failureCode,
      message: failure.message,
      logPath: logger?.path,
    });
    throw new DisplayedCliError(failure.message);
  }
  if (result === undefined) throw new Error(`Runtime operation ${operation} finished without a result`);
  return result;
}

function printRunFailure(input: {
  operation: string;
  node: string | undefined;
  code: string | undefined;
  message: string;
  logPath: string | undefined;
}): void {
  const pairs: Array<[string, string]> = [];
  if (input.node) pairs.push(["node", input.node]);
  if (input.code) pairs.push(["code", ui.bold(input.code)]);
  pairs.push(["reason", input.message]);

  process.stderr.write("\n");
  process.stderr.write(`${ui.err(ui.sym.err)} ${ui.bold(`${input.operation} failed`)}\n`);
  process.stderr.write(`${ui.kvList(pairs)}\n`);
  if (input.logPath) {
    process.stderr.write("\n");
    process.stderr.write(`${ui.dim("full log")}  ${shortPath(input.logPath)}\n`);
    process.stderr.write(`${ui.dim("        ")}  ${ui.dim("daemon stderr appended on failure")}\n`);
  }
}

// After a successful `rig create`, list the workspace's available operations so
// the user doesn't have to guess what to do next. TTY-only — JSON consumers and
// pipes get clean output.
async function printWorkspaceNextSteps(runtime: RuntimeClient, workspaceName: string, workflow: string): Promise<void> {
  if (!process.stderr.isTTY) return;

  let manifest: RuntimeOperationManifest;
  try {
    manifest = await readRuntimeOperations(runtime);
  } catch {
    return;
  }

  const ops = (manifest.workspaceOperations ?? []).filter((op) => op.workflow === workflow && op.id !== "remove");
  const invocations: Array<{ command: string; description: string }> = ops.map((op) => ({
    command: `rig run ${workspaceName} ${op.id}`,
    description: op.description ?? op.title ?? "",
  }));
  invocations.push({ command: `rig rm ${workspaceName}`, description: "Remove this workspace" });

  const commandWidth = invocations.reduce((max, item) => Math.max(max, item.command.length), 0);

  process.stderr.write("\n");
  process.stderr.write(`${ui.bold("Next")}\n`);
  for (const item of invocations) {
    const command = `${ui.bold("rig")}${item.command.slice("rig".length)}`;
    const padding = " ".repeat(Math.max(0, commandWidth - item.command.length));
    const tail = item.description ? `  ${ui.dim(item.description)}` : "";
    process.stderr.write(`${ui.dim(ui.sym.arrow)} ${command}${padding}${tail}\n`);
  }
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
    statePath: options.state ? resolveGlobalPath(invocation, options.state) : undefined,
  };
}

function resolveCommandConfigPaths(invocation: CliInvocation): { projectDir: string; configPath: string } {
  const options = invocation.global;
  return resolveConfigPaths({ chdir: options.chdir });
}

function resolveGlobalPath(invocation: CliInvocation, path: string): string {
  return resolve(process.cwd(), invocation.global.chdir ?? ".", path);
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
  nodePath?: string;
  capability: string;
  params: unknown;
};

type HostRequestHandlingOptions = {
  quietOpen?: boolean;
};

type HostCapabilityLogOptions = {
  stream?: "stdout" | "stderr" | "info";
  label?: string;
};

type HostCapabilityRequestHandlingOptions = {
  logger?: (data: string, options?: HostCapabilityLogOptions) => void;
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

async function answerHostCapabilityRequest(
  runtime: RuntimeClient,
  event: HostCapabilityRequestEvent,
  options: HostCapabilityRequestHandlingOptions = {},
): Promise<void> {
  const requestId = event.requestId ?? event.id;
  if (!requestId) throw new Error(`Host capability request is missing requestId`);
  try {
    const handled = await handleHostCapabilityRequest(event.capability, event.params, options);
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
  options: HostCapabilityRequestHandlingOptions = {},
): Promise<void> {
  const id = event.id ?? event.requestId;
  if (!id) throw new Error(`Host capability request is missing id`);
  try {
    const handled = await handleHostCapabilityRequest(event.capability, event.params, options);
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

function hostCapabilityNeedsTerminal(event: HostCapabilityRequestEvent): boolean {
  switch (event.capability) {
    case "cmux.call":
      return false;
    default:
      return true;
  }
}

function createHostCapabilityLogger(
  event: HostCapabilityRequestEvent,
  presenter: RunPresenter | undefined,
): (data: string, options?: HostCapabilityLogOptions) => void {
  return (data, options = {}) => {
    if (presenter) {
      presenter.render({
        type: "log.output",
        nodePath: event.nodePath ?? "runtime",
        stream: options.stream ?? "info",
        label: options.label ?? event.capability,
        data,
      });
      return;
    }
    console.error(data);
  };
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

async function handleHostCapabilityRequest(
  capability: string,
  params: unknown,
  options: HostCapabilityRequestHandlingOptions = {},
): Promise<HandledHostCapability> {
  const handler = CLI_HOST_CAPABILITY_HANDLERS.get(capability);
  if (!handler) {
    throw new UnsupportedHostCapabilityError(capability);
  }
  return normalizeHostCapabilityResult(await handler.handle(params, {
    log: (data, logOptions) => options.logger?.(data, logOptions),
  }));
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
  const configuredDefaultValue = stringField(params, "defaultValue");
  const defaultValue = configuredDefaultValue ?? options[0]!.value;
  if (!canPrompt()) {
    if (configuredDefaultValue !== undefined) return configuredDefaultValue;
    throw new Error(`Host select prompt requires an interactive terminal: ${message}`);
  }
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

  const pairs: Array<[string, string]> = [
    ["command", input.argv.map(shellDisplay).join(" ")],
    ["mode", input.mode],
  ];
  if (input.cwd) pairs.push(["cwd", input.cwd]);
  if (input.env && Object.keys(input.env).length > 0) {
    pairs.push(["env", Object.keys(input.env).join(", ")]);
  }
  if (input.reason) pairs.push(["reason", input.reason]);

  console.error("");
  console.error(`${ui.warn("!")} ${ui.bold("this config wants to run a command on your machine")}`);
  console.error("");
  console.error(ui.kvList(pairs));
  console.error("");
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
    (value.nodePath === undefined || typeof value.nodePath === "string") &&
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

function printInteractiveOutputGap(invocation: CliInvocation): void {
  if (wantsJson(invocation) || !process.stdout.isTTY) return;
  console.log("");
}

function printPlan(plan: WorkflowPlan): void {
  console.log(`${ui.bold(plan.workflow)}  ${ui.dim(`${plan.cachedNodeCount}/${plan.nodeCount} cached`)}`);
  console.log("");

  if (plan.providerChecks?.length) {
    const rows = plan.providerChecks.map((check) => [
      { text: check.label || check.providerName, style: ui.dim },
      { text: check.status, style: providerCheckStatusStyle(check.status) },
      { text: providerCheckValue(check), style: check.status === "ok" ? ((value: string) => value) : ui.warn },
    ]);
    console.log(ui.columns(["provider check", "status", "current"], rows));
    console.log("");
  }

  const rows = plan.nodes.map((node) => [
    { text: String(node.index + 1), style: ui.dim },
    { text: node.status, style: planStatusStyle(node.status) },
    { text: node.path },
    { text: node.reason ?? "", style: ui.dim },
  ]);
  console.log(ui.columns(["#", "status", "node", "reason"], rows));

  if (plan.nodes.some((node) => node.status === "pending")) {
    console.log("");
    console.log(ui.dim(`For cache details, run: rig cache ${plan.workflow} explain`));
  }
}

function providerCheckValue(check: NonNullable<WorkflowPlan["providerChecks"]>[number]): string {
  if (check.status === "required" && check.message) return check.message;
  if (check.detail && check.detail !== check.value && !check.value.includes(check.detail)) {
    return `${check.value} ${ui.dim(check.detail)}`;
  }
  return check.value;
}

function providerCheckStatusStyle(status: string): (text: string) => string {
  return status === "ok" ? ui.ok : ui.warn;
}

function planStatusStyle(status: string): (text: string) => string {
  switch (status) {
    case "cached":
    case "skipped":
      return ui.dim;
    case "pending":
      return ui.warn;
    case "completed":
    case "ready":
    case "applied":
      return ui.ok;
    case "failed":
    case "error":
      return ui.err;
    default:
      return ui.accent;
  }
}

function printWorkspaces(
  workspaces: ReadonlyArray<Pick<WorkspaceRecord, "name" | "workflow" | "createdAt">>,
): void {
  if (workspaces.length === 0) {
    console.log(ui.dim("no workspaces"));
    return;
  }

  const rows = workspaces.map((workspace) => [
    { text: workspace.name, style: ui.bold },
    { text: workspace.workflow },
    { text: workspace.createdAt, style: ui.dim },
    formatWorkspaceAge(workspace.createdAt),
  ]);
  console.log(ui.columns(["name", "workflow", "created", "age"], rows));
}

type WorkflowOverview = {
  name: string;
  cached: boolean | null;
  cachedNodeCount?: number;
  nodeCount?: number;
  lastAppliedAt?: string;
  planError?: string;
  workspaces: Array<Pick<WorkspaceRecord, "name" | "workflow" | "createdAt" | "updatedAt">>;
};

async function readWorkflowOverview(
  invocation: CliInvocation,
  runtime: RuntimeClient,
  workflowFilter: string | undefined,
): Promise<WorkflowOverview[]> {
  const workflows = await readRuntimeWorkflows(runtime);
  if (workflowFilter) assertKnownWorkflow(workflowFilter, workflows);
  const selected = workflowFilter
    ? workflows.filter((workflow) => workflow.name === workflowFilter)
    : workflows;
  const { workspaces } = await runtime.control.workspaces();
  const allWorkspaces = workspaces as WorkspaceRecord[];

  const overview: WorkflowOverview[] = [];
  for (const workflow of selected) {
    let plan: WorkflowPlan | undefined;
    let planError: string | undefined;
    try {
      plan = await runRuntimeOperation<WorkflowPlan>(
        runtime,
        "plan",
        { workflow: workflow.name },
        { renderEvents: false },
      );
    } catch (error) {
      planError = error instanceof Error ? error.message : String(error);
    }

    overview.push({
      name: workflow.name,
      cached: plan ? plan.cachedNodeCount === plan.nodeCount : null,
      cachedNodeCount: plan?.cachedNodeCount,
      nodeCount: plan?.nodeCount,
      lastAppliedAt: workflow.lastAppliedAt,
      planError,
      workspaces: allWorkspaces
        .filter((workspace) => workspace.workflow === workflow.name)
        .sort((left, right) => left.name.localeCompare(right.name)),
    });
  }
  return overview;
}

function printWorkflowWorkspaces(workflows: WorkflowOverview[]): void {
  if (workflows.length === 0) {
    console.log(ui.dim("no workflows"));
    return;
  }

  const sortedWorkflows = sortWorkflowsForListing(workflows);
  printWorkflowsSection(sortedWorkflows);
  console.log("");
  printWorkspacesSection(sortedWorkflows);

  const planErrors = sortedWorkflows.filter((workflow) => workflow.planError);
  if (planErrors.length > 0) {
    console.log("");
    for (const workflow of planErrors) {
      console.log(`  ${ui.warn(workflow.name)}  ${workflow.planError}`);
    }
  }
}

function sortWorkflowsForListing(workflows: WorkflowOverview[]): WorkflowOverview[] {
  return [...workflows].sort((left, right) => {
    const leftHas = left.workspaces.length > 0 ? 1 : 0;
    const rightHas = right.workspaces.length > 0 ? 1 : 0;
    if (leftHas !== rightHas) return rightHas - leftHas;
    const leftApplied = left.lastAppliedAt ? Date.parse(left.lastAppliedAt) : 0;
    const rightApplied = right.lastAppliedAt ? Date.parse(right.lastAppliedAt) : 0;
    if (leftApplied !== rightApplied) return rightApplied - leftApplied;
    return left.name.localeCompare(right.name);
  });
}

function printWorkflowsSection(workflows: WorkflowOverview[]): void {
  console.log(ui.bold("workflows"));
  const rows = workflows.map((workflow) => [
    { text: workflow.name, style: ui.bold },
    formatWorkflowCacheCell(workflow),
    formatWorkflowAppliedCell(workflow),
  ]);
  console.log(ui.columns(["name", "cached", "applied"], rows));
}

function printWorkspacesSection(workflows: WorkflowOverview[]): void {
  console.log(ui.bold("workspaces"));
  const flattened = workflows.flatMap((workflow) =>
    workflow.workspaces.map((workspace) => ({ ...workspace, workflowName: workflow.name })),
  );
  if (flattened.length === 0) {
    console.log(`  ${ui.dim("none")}`);
    return;
  }
  flattened.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  const showWorkflowColumn = workflows.length > 1;
  const headers = showWorkflowColumn
    ? ["name", "workflow", "age", "created"]
    : ["name", "age", "created"];
  const rows = flattened.map((workspace) => {
    const cells: Array<{ text: string; style?: (text: string) => string }> = [
      { text: workspace.name, style: ui.bold },
    ];
    if (showWorkflowColumn) cells.push({ text: workspace.workflowName, style: ui.dim });
    cells.push(formatWorkspaceAge(workspace.createdAt));
    cells.push({ text: formatCreatedTimestamp(workspace.createdAt), style: ui.dim });
    return cells;
  });
  console.log(ui.columns(headers, rows));
}

function formatWorkflowCacheCell(workflow: WorkflowOverview): { text: string; style: (text: string) => string } {
  if (workflow.cached === null) return { text: "unavailable", style: ui.warn };
  const text = `${workflow.cachedNodeCount}/${workflow.nodeCount}`;
  return { text, style: workflow.cached ? ui.ok : ui.dim };
}

function formatWorkflowAppliedCell(workflow: WorkflowOverview): { text: string; style: (text: string) => string } {
  if (!workflow.lastAppliedAt) return { text: "—", style: ui.dim };
  return { text: formatRelativeAge(workflow.lastAppliedAt), style: ui.dim };
}

function formatWorkspaceAge(createdAt: string): { text: string; style: (text: string) => string } {
  return { text: formatRelativeAge(createdAt), style: ageStyle(createdAt) };
}

function formatRelativeAge(createdAt: string): string {
  const createdTime = Date.parse(createdAt);
  if (Number.isNaN(createdTime)) return "unknown";

  const ageMs = Math.max(0, Date.now() - createdTime);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ageMs < minute) return "just now";
  if (ageMs < hour) return `${Math.floor(ageMs / minute)}m ago`;
  if (ageMs < day) return `${Math.floor(ageMs / hour)}h ago`;
  return `${Math.floor(ageMs / day)}d ago`;
}

function ageStyle(createdAt: string): (text: string) => string {
  const createdTime = Date.parse(createdAt);
  if (Number.isNaN(createdTime)) return ui.dim;
  const ageMs = Math.max(0, Date.now() - createdTime);
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < day) return ui.ok;
  if (ageMs <= 3 * day) return ui.warn;
  return ui.dim;
}

function formatCreatedTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function printSnapshots(snapshots: SnapshotRecord[]): void {
  if (snapshots.length === 0) {
    console.log(ui.dim("no snapshots"));
    return;
  }

  const rows = snapshots.map((snapshot) => [
    { text: snapshot.id, style: ui.dim },
    { text: snapshot.workflow },
    { text: snapshot.nodePath, style: ui.bold },
    { text: typeof snapshot.metadata.snapshotId === "string" ? snapshot.metadata.snapshotId : "" },
    { text: formatCreatedTimestamp(snapshot.createdAt), style: ui.dim },
  ]);
  console.log(ui.columns(["run", "workflow", "node", "snapshot", "created"], rows));
}

function printCacheEntries(entries: ReadonlyArray<{
  scope: "local" | "global";
  workflow: string;
  nodePath: string;
  displayPath?: string;
  planIndex?: number;
  nodeName: string;
  createdAt: string;
  invalidated: boolean;
  fragmentHash?: string;
}>): void {
  if (entries.length === 0) {
    console.log(ui.dim("no cache entries"));
    return;
  }

  const rows = entries.map((entry) => [
    { text: entry.planIndex === undefined ? "" : String(entry.planIndex + 1), style: ui.dim },
    {
      text: entry.invalidated ? "invalidated" : "cached",
      style: entry.invalidated ? ui.warn : ui.dim,
    },
    { text: entry.displayPath || entry.nodePath || entry.nodeName, style: ui.bold },
    { text: entry.scope, style: ui.dim },
    { text: entry.workflow },
    { text: entry.fragmentHash ? entry.fragmentHash.slice(0, 19) : "", style: ui.dim },
    { text: formatCreatedTimestamp(entry.createdAt), style: ui.dim },
  ]);
  console.log(ui.columns(["#", "status", "node", "scope", "workflow", "fragment", "created"], rows));
}

function printCacheExplanations(explanations: readonly RuntimeControlCacheExplanation[]): void {
  if (explanations.length === 0) {
    console.log(ui.dim("no cache tasks"));
    return;
  }

  const rows = explanations.map((entry, index) => [
    { text: String(index + 1), style: ui.dim },
    { text: entry.status, style: planStatusStyle(entry.status) },
    { text: entry.path, style: ui.bold },
    { text: formatCacheExplainReason(entry.reason), style: entry.status === "cached" ? ui.dim : ui.warn },
    { text: formatCacheExplainCandidate(entry), style: ui.dim },
  ]);
  console.log(ui.columns(["#", "status", "node", "reason", "latest candidate"], rows));
}

function formatCacheExplainReason(reason: RuntimeControlCacheExplanation["reason"]): string {
  return reason.detail ? `${reason.message} (${reason.detail})` : reason.message;
}

function formatCacheExplainCandidate(entry: RuntimeControlCacheExplanation): string {
  const candidate = entry.candidates[0];
  if (!candidate) return "";
  const reason = candidate.reasons[0];
  const prefix = entry.runId === candidate.runId ? "run" : reason?.message ?? "run";
  return `${prefix} ${candidate.runId.slice(0, 8)} ${formatCreatedTimestamp(candidate.createdAt)}`;
}

function printConfig(info: EngineProjectInfo): void {
  console.log(ui.kvList([
    ["config", info.configPath],
    ["project", info.projectDir],
    ["state", info.statePath ?? ""],
    ["workflows", info.workflows.map((workflow) => workflow.name).join(", ")],
  ]));
}

function normalizeListTarget(target: string | undefined): "workspaces" | "snapshots" | "config" {
  if (!target || target === "workspaces" || target === "workspace" || target === "vms" || target === "vm") {
    return "workspaces";
  }
  if (target === "snapshots" || target === "snapshot") return "snapshots";
  if (target === "config" || target === "machine" || target === "machines") return "config";
  throw new Error(`Unknown ls target ${target}. Expected workspaces, snapshots, or config.`);
}

function renderEvent(event: DevMachineEvent): void {
  const write = (line: string) => process.stderr.write(`${line}\n`);
  switch (event.type) {
    case "definition.loaded":
      write(`${ui.dim(ui.sym.dot)} ${ui.dim(`loaded ${event.workflow}`)}`);
      return;
    case "plan.created":
      write(`${ui.accent(ui.sym.active)} ${ui.bold(event.workflow)}  ${ui.dim(`${event.cachedNodeCount}/${event.nodeCount} cached`)}`);
      return;
    case "workflow.apply.started":
      write(`${ui.accent(ui.sym.active)} workflow ${ui.bold(event.workflow)}`);
      return;
    case "workflow.apply.completed": {
      const summary = event.nodeCount > 0
        ? `  ${ui.dim(`${event.cachedNodeCount}/${event.nodeCount} cached`)}`
        : "";
      write(`${ui.ok(ui.sym.ok)} ${ui.bold(event.workflow)} ${ui.dim("prepared")}${summary}`);
      return;
    }
    case "node.cached":
      write(`  ${ui.dim(ui.sym.ok)} ${ui.dim(`${event.nodePath}  cached`)}`);
      return;
    case "vm.created":
      write(`  ${ui.dim(event.fromSnapshotId ? `vm ${event.vmId} from ${event.fromSnapshotId}` : `vm ${event.vmId} created`)}`);
      return;
    case "node.started":
      write(`  ${ui.accent(ui.sym.active)} ${ui.bold(String(event.nodePath))}`);
      return;
    case "node.completed":
      write(`  ${ui.ok(ui.sym.ok)} ${event.nodePath}`);
      return;
    case "command.started":
      write(`    ${ui.dim(`$ ${event.commandName}`)}`);
      return;
    case "command.output":
      process.stderr.write(event.data);
      return;
    case "command.completed":
      if (event.exitCode !== 0) {
        write(`    ${ui.err(`${event.commandName} exited ${event.exitCode}`)}`);
      }
      return;
    case "log.output": {
      const prefix = event.stream && event.stream !== "info" && event.stream !== "stdout"
        ? `[${event.stream}] `
        : "";
      for (const line of event.data.replace(/\r/g, "").split("\n")) {
        if (!line) continue;
        process.stderr.write(`${prefix}${line}\n`);
      }
      return;
    }
    case "interaction.awaiting_user":
      write(`  ${ui.accent(ui.sym.arrow)} waiting on ${ui.bold(event.label)}`);
      write(`    ${ui.dim(event.url)}`);
      return;
    case "interaction.completed":
      write(`  ${ui.ok(ui.sym.ok)} ${ui.dim(`${event.label} completed`)}`);
      return;
    case "artifact.created":
      write(`    ${ui.dim(`+ ${event.providerId}:${event.kind}`)}`);
      return;
    case "workspace.create.started":
      write(`${ui.accent(ui.sym.active)} creating workspace ${ui.bold(String(event.workspaceName))}`);
      return;
    case "workspace.ready":
      write(`${ui.ok(ui.sym.ok)} ${ui.bold(String(event.workspaceId))} ${ui.dim("ready")}`);
      return;
    case "workspace.remove.started":
      write(`${ui.accent(ui.sym.active)} removing workspace ${ui.bold(String(event.workspaceName))}`);
      return;
    case "workspace.remove.completed":
      write(`${ui.ok(ui.sym.ok)} removed ${ui.bold(String(event.workspaceName))}`);
      return;
    case "workspace.operation.started":
      write(`${ui.accent(ui.sym.active)} running ${ui.bold(String(event.operationId))} on ${ui.bold(String(event.workspaceName))}`);
      return;
    case "workspace.operation.completed":
      write(`${ui.ok(ui.sym.ok)} ran ${ui.bold(String(event.operationId))} on ${ui.bold(String(event.workspaceName))}`);
      return;
    default:
      return;
  }
}
