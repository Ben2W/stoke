import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getOrStartRuntime } from "@rigkit/runtime-client";
import { DEFAULT_CONFIG_FILE, DEFAULT_CONFIG_PATH, projectDirForConfigPath } from "./project.ts";

export type CompletionShell = "bash" | "fish" | "zsh";

export type CompletionItem = {
  value: string;
  description?: string;
  noSpace?: boolean;
  group?: string;
};

type CompleteRigInput = {
  words: string[];
  currentIndex?: number;
  cwd?: string;
};

type CommandName =
  | "help"
  | "init"
  | "plan"
  | "apply"
  | "create"
  | "rm"
  | "run"
  | "ls"
  | "cache"
  | "providers"
  | "projects"
  | "doctor"
  | "version"
  | "completion";

type CompletionContext = {
  cwd: string;
  words: string[];
  currentIndex: number;
  current: string;
  before: string[];
  command?: CommandName;
  commandIndex?: number;
  argsBefore: string[];
  unknownRootPositionals: string[];
};

type ValueCompletionKind =
  | "directories"
  | "config-files"
  | "filesystem"
  | "package-managers";

type OptionDefinition = {
  flags: string[];
  completions?: Array<{ value: string; noSpace?: boolean }>;
  description: string;
  group: string;
  takesValue?: boolean;
  valueKind?: ValueCompletionKind;
  operation?: RuntimeOperationDefinition;
  runtimeOption?: RuntimeOperationCliOption;
};

type RuntimeOperationManifest = {
  operations: RuntimeOperationDefinition[];
  workspaceOperations?: RuntimeOperationDefinition[];
};

type RuntimeOperationDefinition = {
  workflow: string;
  id: string;
  aliases?: string[];
  title?: string;
  description?: string;
  createsWorkspace?: boolean;
  cli?: {
    positionals?: Array<{ name: string; index: number }>;
    options?: RuntimeOperationCliOption[];
  };
  inputSchema?: {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
};

type RuntimeOperationCliOption = {
  name: string;
  flag: string;
  aliases?: string[];
  required?: boolean;
  runtime?: boolean;
  type?: "string" | "boolean" | "number";
};

type JsonSchemaProperty = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};

type RuntimeWorkspaceCompletion = {
  name: string;
  workflow: string;
  createdAt: string;
  updatedAt: string;
};

type RuntimeCacheCompletionEntry = {
  scope: "local" | "global";
  workflow: string;
  nodePath: string;
  nodeName: string;
  invalidated: boolean;
  createdAt: string;
};

const GROUP_COMMANDS = "Commands";
const GROUP_SUBCOMMANDS = "Subcommands";
const GROUP_FLAGS = "Flags";
const GROUP_GLOBAL = "Global flags";
const GROUP_TARGETS = "Targets";
const GROUP_WORKSPACES = "Workspaces";
const GROUP_OPERATIONS = "Operations";
const GROUP_VALUES = "Values";
const GROUP_PATHS = "Paths";
const GROUP_SHELLS = "Shells";
const GROUP_CACHE = "Cache entries";
const GROUP_PROVIDERS = "Providers";

const COMMANDS: CompletionItem[] = withGroup(GROUP_COMMANDS, [
  { value: "help", description: "show CLI help" },
  { value: "init", description: "initialize a Rigkit project" },
  { value: "plan", description: "plan project workflow changes" },
  { value: "apply", description: "apply project workflow changes" },
  { value: "create", description: "create a workspace" },
  { value: "rm", description: "remove a workspace" },
  { value: "run", description: "run a workspace operation" },
  { value: "ls", description: "list project workspaces" },
  { value: "cache", description: "inspect and clear Rigkit cache" },
  { value: "providers", description: "manage provider-owned local state" },
  { value: "projects", description: "discover Rigkit projects" },
  { value: "doctor", description: "show runtime diagnostics" },
  { value: "version", description: "show CLI version" },
  { value: "completion", description: "generate shell completion" },
]);

const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.value as CommandName));

const JSON_OPTION = option(["--json"], "print JSON");
const HELP_OPTION = option(["--help"], "show help");

const GLOBAL_OPTIONS: OptionDefinition[] = [
  option(["--chdir"], "working directory", {
    group: GROUP_GLOBAL,
    takesValue: true,
    valueKind: "directories",
    completions: [
      { value: "--chdir=", noSpace: true },
    ],
  }),
  option(["--config"], "config file", {
    group: GROUP_GLOBAL,
    takesValue: true,
    valueKind: "config-files",
    completions: [
      { value: "--config=", noSpace: true },
    ],
  }),
  option(["--state"], "state database path", {
    group: GROUP_GLOBAL,
    takesValue: true,
    valueKind: "filesystem",
    completions: [
      { value: "--state=", noSpace: true },
    ],
  }),
  option(["--json"], "print JSON", {
    group: GROUP_GLOBAL,
    completions: [{ value: "--json" }],
  }),
  option(["--help"], "show help", {
    group: GROUP_GLOBAL,
    completions: [{ value: "--help" }],
  }),
  option(["--version", "-v"], "show version", {
    group: GROUP_GLOBAL,
    completions: [{ value: "--version" }, { value: "-v" }],
  }),
];

const COMMAND_OPTIONS: Record<CommandName, OptionDefinition[]> = {
  init: [
    option(["--dir"], "directory to initialize", { takesValue: true, valueKind: "directories" }),
    option(["--name"], "project/package name", { takesValue: true }),
    option(["--api-key"], "Freestyle API key", { takesValue: true }),
    option(["--package-manager"], "npm, bun, pnpm, or skip", {
      takesValue: true,
      valueKind: "package-managers",
    }),
    option(["--force"], "overwrite existing config"),
    JSON_OPTION,
    HELP_OPTION,
  ],
  plan: [
    option(["--all"], "run against every discovered project"),
    option(["--discover"], "discover projects below the selected directory"),
    JSON_OPTION,
    HELP_OPTION,
  ],
  apply: [
    option(["--all"], "run against every discovered project"),
    option(["--discover"], "discover projects below the selected directory"),
    JSON_OPTION,
    HELP_OPTION,
  ],
  create: [
    JSON_OPTION,
    HELP_OPTION,
  ],
  rm: [
    option(["-y", "--yes"], "skip confirmation"),
    option(["--all"], "remove every workspace"),
    option(["--workflow"], "workflow name", { takesValue: true }),
    JSON_OPTION,
    HELP_OPTION,
  ],
  run: [
    option(["--workflow"], "workflow name", { takesValue: true }),
    JSON_OPTION,
    HELP_OPTION,
  ],
  ls: [
    option(["--workflow"], "workflow name", { takesValue: true }),
    JSON_OPTION,
    HELP_OPTION,
  ],
  cache: [
    HELP_OPTION,
  ],
  providers: [
    HELP_OPTION,
  ],
  projects: [
    JSON_OPTION,
    HELP_OPTION,
  ],
  doctor: [
    option(["--cli"], "show CLI diagnostics only"),
    JSON_OPTION,
    HELP_OPTION,
  ],
  version: [
    JSON_OPTION,
    HELP_OPTION,
  ],
  help: [
    JSON_OPTION,
    HELP_OPTION,
  ],
  completion: [
    HELP_OPTION,
  ],
};

const CORE_OPERATION_OPTIONS: Partial<Record<CommandName, OptionDefinition[]>> = {
  plan: [
    option(["--workflow"], "workflow name", { takesValue: true }),
  ],
  apply: [
    option(["--workflow"], "workflow name", { takesValue: true }),
    option(["--dry-run"], "plan without applying changes"),
  ],
  create: [
    option(["--workflow"], "workflow name", { takesValue: true }),
    option(["--name"], "workspace name", { takesValue: true }),
  ],
};

const LIST_TARGETS: CompletionItem[] = withGroup(GROUP_TARGETS, [
  { value: "workspaces", description: "list workspaces" },
  { value: "snapshots", description: "list snapshots" },
  { value: "config", description: "show project config" },
]);

const CACHE_SUBCOMMANDS: CompletionItem[] = withGroup(GROUP_SUBCOMMANDS, [
  { value: "ls", description: "list cache entries" },
  { value: "clear", description: "clear cache entries" },
  { value: "invalidate", description: "mark cached task outputs stale" },
]);

const CACHE_SUBCOMMAND_OPTIONS: Record<string, OptionDefinition[]> = {
  ls: [
    JSON_OPTION,
    HELP_OPTION,
  ],
  clear: [
    option(["--local"], "clear local cache entries"),
    option(["--global"], "clear global cache fragments"),
    option(["--all"], "clear every global fragment with --global"),
    JSON_OPTION,
    HELP_OPTION,
  ],
  invalidate: [
    option(["--all"], "invalidate every cached task"),
    option(["-y", "--yes"], "skip confirmation"),
    JSON_OPTION,
    HELP_OPTION,
  ],
};

const PROVIDER_TARGETS: CompletionItem[] = withGroup(GROUP_PROVIDERS, [
  { value: "freestyle", description: "Freestyle provider state" },
]);

const PROVIDER_SUBCOMMANDS: Record<string, CompletionItem[]> = {
  freestyle: withGroup(GROUP_SUBCOMMANDS, [
    { value: "clear", description: "clear Freestyle provider local auth and identity state" },
  ]),
};

const PROVIDER_TARGET_OPTIONS: Record<string, OptionDefinition[]> = {
  freestyle: [
    HELP_OPTION,
  ],
};

const PROVIDER_SUBCOMMAND_OPTIONS: Record<string, Record<string, OptionDefinition[]>> = {
  freestyle: {
    clear: [
      JSON_OPTION,
      HELP_OPTION,
    ],
  },
};

const COMPLETION_SHELLS: CompletionItem[] = withGroup(GROUP_SHELLS, [
  { value: "bash", description: "Bash completion" },
  { value: "fish", description: "fish completion" },
  { value: "zsh", description: "zsh completion" },
]);

const PROJECT_OPERATION_COMMANDS = new Set<CommandName>(["plan", "apply", "create"]);

function withGroup(group: string, items: Omit<CompletionItem, "group">[]): CompletionItem[] {
  return items.map((item) => ({ ...item, group }));
}

function option(
  flags: string[],
  description: string,
  input: Partial<Omit<OptionDefinition, "flags" | "description">> = {},
): OptionDefinition {
  return {
    flags,
    description,
    group: input.group ?? GROUP_FLAGS,
    takesValue: input.takesValue,
    valueKind: input.valueKind,
    completions: input.completions,
    operation: input.operation,
    runtimeOption: input.runtimeOption,
  };
}

export async function completeRig(input: CompleteRigInput): Promise<CompletionItem[]> {
  const context = completionContext(input);

  const valueRequest = await optionValueRequest(context);
  if (valueRequest) {
    return await completeOptionValue(valueRequest);
  }

  if (!context.command) {
    if (context.unknownRootPositionals.length > 0) return [];
    return filterItems(
      context.current.startsWith("-")
        ? optionItems(GLOBAL_OPTIONS)
        : [...COMMANDS, ...optionItems(GLOBAL_OPTIONS)],
      context.current,
    );
  }

  return await completeCommand(context);
}

function completionContext(input: CompleteRigInput): CompletionContext {
  const cwd = input.cwd ?? process.cwd();
  const words = input.words.length > 0 ? input.words : ["rig"];
  const currentIndex = input.currentIndex ?? Math.max(0, words.length - 1);
  const current = words[currentIndex] ?? "";
  const before = words.slice(1, currentIndex);
  const unknownRootPositionals: string[] = [];
  let command: CommandName | undefined;
  let commandIndex: number | undefined;

  for (let index = 0; index < before.length; index += 1) {
    const word = before[index]!;
    const globalOption = findOption(GLOBAL_OPTIONS, word);
    if (globalOption?.takesValue && !hasInlineValue(word)) {
      index += 1;
      continue;
    }
    if (isOptionToken(word)) continue;

    if (isCommandName(word)) {
      command = word;
      commandIndex = index;
      break;
    }

    unknownRootPositionals.push(word);
  }

  return {
    cwd,
    words,
    currentIndex,
    current,
    before,
    command,
    commandIndex,
    argsBefore: commandIndex === undefined ? [] : before.slice(commandIndex + 1),
    unknownRootPositionals,
  };
}

async function optionValueRequest(context: CompletionContext): Promise<{
  option: OptionDefinition;
  current: string;
  cwd: string;
  words: string[];
  inlinePrefix?: string;
} | undefined> {
  const inlineOption = parseInlineValueOption(context.current);
  if (inlineOption) {
    const definition = await resolveOptionDefinition(context, inlineOption.option);
    if (definition?.takesValue || definition?.runtimeOption?.type === "boolean") {
      return {
        option: definition,
        current: inlineOption.value,
        cwd: context.cwd,
        words: context.words,
        inlinePrefix: inlineOption.prefix,
      };
    }
  }

  const previous = context.before.at(-1);
  if (!previous) return undefined;
  if (hasInlineValue(previous)) return undefined;

  const definition = await resolveOptionDefinition(context, previous);
  if (!definition?.takesValue) return undefined;
  return {
    option: definition,
    current: context.current,
    cwd: context.cwd,
    words: context.words,
  };
}

async function resolveOptionDefinition(
  context: CompletionContext,
  flag: string,
): Promise<OptionDefinition | undefined> {
  const globalOption = findOption(GLOBAL_OPTIONS, flag);
  if (globalOption) return globalOption;
  if (!context.command) return undefined;

  const commandOptions = await optionsForCommandContext(context);
  return findOption(commandOptions, flag);
}

async function optionsForCommandContext(context: CompletionContext): Promise<OptionDefinition[]> {
  if (!context.command) return GLOBAL_OPTIONS;

  if (PROJECT_OPERATION_COMMANDS.has(context.command)) {
    const operation = await safeResolveRuntimeOperation(resolveProjectDir(context.words, context.cwd), context.command);
    return mergeOptions([
      ...operationOptions(operation),
      ...(CORE_OPERATION_OPTIONS[context.command] ?? []),
      ...COMMAND_OPTIONS[context.command],
    ]);
  }

  if (context.command === "run") {
    const run = parseRunArgs(context);
    if (run.workspace && run.operation) {
      const operation = await safeResolveWorkspaceOperation(resolveProjectDir(context.words, context.cwd), run.operation);
      return mergeOptions([
        ...operationOptions(operation),
        ...COMMAND_OPTIONS.run,
      ]);
    }
  }

  if (context.command === "rm") {
    const remove = parseRmArgs(context);
    if (remove.workspace) {
      const operation = await safeResolveWorkspaceOperation(resolveProjectDir(context.words, context.cwd), "remove");
      return mergeOptions([
        ...operationOptions(operation),
        ...COMMAND_OPTIONS.rm,
      ]);
    }
  }

  if (context.command === "cache") {
    const cache = parseCacheArgs(context);
    if (cache.subcommand) return CACHE_SUBCOMMAND_OPTIONS[cache.subcommand] ?? [HELP_OPTION];
  }

  if (context.command === "providers") {
    const providers = parseProvidersArgs(context);
    if (providers.provider && providers.subcommand) {
      return PROVIDER_SUBCOMMAND_OPTIONS[providers.provider]?.[providers.subcommand] ?? [HELP_OPTION];
    }
    if (providers.provider) return PROVIDER_TARGET_OPTIONS[providers.provider] ?? [HELP_OPTION];
  }

  return COMMAND_OPTIONS[context.command] ?? [];
}

async function completeOptionValue(input: {
  option: OptionDefinition;
  current: string;
  cwd: string;
  words: string[];
  inlinePrefix?: string;
}): Promise<CompletionItem[]> {
  let items: CompletionItem[];
  switch (input.option.valueKind) {
    case "directories":
      items = completeDirectories(input.cwd, input.current);
      break;
    case "config-files":
      items = completeConfigPaths(projectBaseDir(input.words, input.cwd), input.current);
      break;
    case "filesystem":
      items = completeFilesystemPaths(input.cwd, input.current);
      break;
    case "package-managers":
      items = filterItems([
        { value: "npm", group: GROUP_VALUES },
        { value: "bun", group: GROUP_VALUES },
        { value: "pnpm", group: GROUP_VALUES },
        { value: "skip", group: GROUP_VALUES },
      ], input.current);
      break;
    default:
      items = await completeRuntimeOptionValue(input.option, input.current, input.words, input.cwd);
      break;
  }

  if (!input.inlinePrefix) return items;
  return items.map((item) => ({
    ...item,
    value: `${input.inlinePrefix}${item.value}`,
  }));
}

async function completeRuntimeOptionValue(
  option: OptionDefinition,
  current: string,
  words: string[],
  cwd: string,
): Promise<CompletionItem[]> {
  const runtimeOption = option.runtimeOption;
  const operation = option.operation;

  if (runtimeOption?.type === "boolean") {
    return filterItems([
      { value: "true", group: GROUP_VALUES },
      { value: "false", group: GROUP_VALUES },
    ], current);
  }

  const schema = operation && runtimeOption ? operation.inputSchema?.properties?.[runtimeOption.name] : undefined;
  const enumItems = enumCompletionItems(schema);
  if (enumItems.length > 0) return filterItems(enumItems, current);

  if (runtimeOption?.name === "workflow" || option.flags.includes("--workflow")) {
    return filterItems(await safeWorkflowTargets(resolveProjectDir(words, cwd)), current);
  }

  return [];
}

async function completeCommand(context: CompletionContext): Promise<CompletionItem[]> {
  switch (context.command) {
    case "plan":
    case "apply":
    case "create":
      return await completeProjectOperationCommand(context);
    case "run":
      return await completeRunCommand(context);
    case "rm":
      return await completeRmCommand(context);
    case "ls":
      return completeLsCommand(context);
    case "cache":
      return await completeCacheCommand(context);
    case "providers":
      return completeProvidersCommand(context);
    case "completion":
      return completeCompletionCommand(context);
    case "init":
    case "projects":
    case "doctor":
    case "version":
    case "help":
      return completeOptionsOnlyCommand(context, COMMAND_OPTIONS[context.command]);
  }
  return [];
}

async function completeProjectOperationCommand(context: CompletionContext): Promise<CompletionItem[]> {
  const operation = await safeResolveRuntimeOperation(resolveProjectDir(context.words, context.cwd), context.command!);
  const options = mergeOptions([
    ...operationOptions(operation),
    ...(CORE_OPERATION_OPTIONS[context.command!] ?? []),
    ...COMMAND_OPTIONS[context.command!],
  ]);
  const positionals = positionalsFrom(context.argsBefore, options);

  if (context.current.startsWith("-") || context.current === "") {
    const positionalItems = operation ? operationPositionalValueItems(operation, positionals.length, context.current) : [];
    return filterItems([...positionalItems, ...optionItems(options)], context.current);
  }

  if (!operation) return [];
  return filterItems(operationPositionalValueItems(operation, positionals.length, context.current), context.current);
}

async function completeRunCommand(context: CompletionContext): Promise<CompletionItem[]> {
  const paths = resolveProjectDir(context.words, context.cwd);
  const baseOptions = COMMAND_OPTIONS.run;
  const run = parseRunArgs(context);

  if (!run.workspace) {
    return completeMixed({
      primary: await safeWorkspaceTargets(paths),
      options: baseOptions,
      current: context.current,
    });
  }

  if (!run.operation) {
    return completeMixed({
      primary: await safeWorkspaceOperationTargets(paths),
      options: baseOptions,
      current: context.current,
    });
  }

  const operation = await safeResolveWorkspaceOperation(paths, run.operation);
  const options = mergeOptions([
    ...operationOptions(operation),
    ...baseOptions,
  ]);
  const positionals = positionalsFrom(run.args, options);

  if (context.current.startsWith("-") || context.current === "") {
    const positionalItems = operation ? operationPositionalValueItems(operation, positionals.length, context.current) : [];
    return filterItems([...positionalItems, ...optionItems(options)], context.current);
  }

  if (!operation) return [];
  return filterItems(operationPositionalValueItems(operation, positionals.length, context.current), context.current);
}

async function completeRmCommand(context: CompletionContext): Promise<CompletionItem[]> {
  const paths = resolveProjectDir(context.words, context.cwd);
  const remove = parseRmArgs(context);
  const operation = remove.workspace ? await safeResolveWorkspaceOperation(paths, "remove") : undefined;
  const options = mergeOptions([
    ...operationOptions(operation),
    ...COMMAND_OPTIONS.rm,
  ]);

  if (!remove.workspace) {
    return completeMixed({
      primary: await safeWorkspaceTargets(paths),
      options,
      current: context.current,
    });
  }

  if (context.current.startsWith("-") || context.current === "") {
    return filterItems(optionItems(options), context.current);
  }

  return [];
}

function completeLsCommand(context: CompletionContext): CompletionItem[] {
  const options = COMMAND_OPTIONS.ls;
  const targets = positionalsFrom(context.argsBefore, options);
  if (targets.length === 0) {
    return completeMixed({
      primary: LIST_TARGETS,
      options,
      current: context.current,
    });
  }

  if (context.current.startsWith("-") || context.current === "") {
    return filterItems(optionItems(options), context.current);
  }

  return [];
}

async function completeCacheCommand(context: CompletionContext): Promise<CompletionItem[]> {
  const cache = parseCacheArgs(context);
  if (!cache.subcommand) {
    if (context.current.startsWith("-")) return filterItems(optionItems(COMMAND_OPTIONS.cache), context.current);
    return filterItems(CACHE_SUBCOMMANDS, context.current);
  }

  const options = CACHE_SUBCOMMAND_OPTIONS[cache.subcommand] ?? [HELP_OPTION];
  if (cache.subcommand !== "invalidate") {
    return completeOptionsOnlyCommand(context, options);
  }

  const stepArgs = positionalsFrom(cache.args, options);
  if (stepArgs.length === 0) {
    return completeMixed({
      primary: await safeCacheInvalidateTargets(resolveProjectDir(context.words, context.cwd)),
      options,
      current: context.current,
    });
  }

  if (context.current.startsWith("-") || context.current === "") {
    return filterItems(optionItems(options), context.current);
  }

  return [];
}

function completeProvidersCommand(context: CompletionContext): CompletionItem[] {
  const providers = parseProvidersArgs(context);
  if (!providers.provider) {
    if (context.current.startsWith("-")) return filterItems(optionItems(COMMAND_OPTIONS.providers), context.current);
    return filterItems(PROVIDER_TARGETS, context.current);
  }

  if (!providers.subcommand) {
    const options = PROVIDER_TARGET_OPTIONS[providers.provider] ?? [HELP_OPTION];
    const subcommands = PROVIDER_SUBCOMMANDS[providers.provider] ?? [];
    if (context.current.startsWith("-")) return filterItems(optionItems(options), context.current);
    return filterItems(subcommands, context.current);
  }

  const options = PROVIDER_SUBCOMMAND_OPTIONS[providers.provider]?.[providers.subcommand] ?? [HELP_OPTION];
  return completeOptionsOnlyCommand(context, options);
}

function completeCompletionCommand(context: CompletionContext): CompletionItem[] {
  const shells = positionalsFrom(context.argsBefore, COMMAND_OPTIONS.completion);
  if (shells.length === 0) {
    return completeMixed({
      primary: COMPLETION_SHELLS,
      options: COMMAND_OPTIONS.completion,
      current: context.current,
    });
  }

  if (context.current.startsWith("-") || context.current === "") {
    return filterItems(optionItems(COMMAND_OPTIONS.completion), context.current);
  }

  return [];
}

function completeOptionsOnlyCommand(context: CompletionContext, options: OptionDefinition[]): CompletionItem[] {
  if (context.current.startsWith("-") || context.current === "") {
    return filterItems(optionItems(options), context.current);
  }
  return [];
}

function completeMixed(input: {
  primary: CompletionItem[];
  options: OptionDefinition[];
  current: string;
}): CompletionItem[] {
  if (input.current.startsWith("-")) return filterItems(optionItems(input.options), input.current);
  if (input.current === "") return filterItems([...input.primary, ...optionItems(input.options)], input.current);
  return filterItems(input.primary, input.current);
}

export function formatCompletionItems(items: CompletionItem[], shell: CompletionShell): string {
  const lines = items.map((item) => {
    if (shell === "bash") return item.value;
    if (shell === "zsh") {
      const description = item.description ?? "";
      const marker = item.noSpace ? "nospace" : "";
      const group = item.group ?? "";
      return `${item.value}\t${description}\t${marker}\t${group}`;
    }
    return item.description ? `${item.value}\t${item.description}` : item.value;
  });
  return lines.join("\n");
}

export function resolveCompletionShell(value: string | undefined, env: NodeJS.ProcessEnv = process.env): CompletionShell {
  if (value === "bash" || value === "fish" || value === "zsh") return value;
  if (value) throw new Error(`Unsupported shell ${value}. Expected bash, fish, or zsh.`);

  const shell = env.SHELL ?? "";
  if (shell.endsWith("/fish")) return "fish";
  if (shell.endsWith("/bash")) return "bash";
  return "zsh";
}

export function renderCompletionScript(shell: CompletionShell): string {
  if (shell === "bash") {
    return `# rig bash completion
_rig_completion() {
  local completions
  completions="$(command rig __complete --shell bash --index "$COMP_CWORD" -- "\${COMP_WORDS[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "$completions" -- "\${COMP_WORDS[COMP_CWORD]}"))
  if [[ "\${#COMPREPLY[@]}" -eq 1 && ( "\${COMPREPLY[0]}" == */ || "\${COMPREPLY[0]}" == *= ) ]]; then
    compopt -o nospace 2>/dev/null || true
  fi
}
complete -F _rig_completion rig
`;
  }

  if (shell === "fish") {
    return `# rig fish completion
function __rig_complete
  set -l tokens (commandline -opc)
  set -l current (commandline -ct)
  set -l index (count $tokens)
  command rig __complete --shell fish --index $index -- $tokens $current 2>/dev/null
end
complete -c rig -f -a "(__rig_complete)"
`;
  }

  return `#compdef rig
# rig zsh completion generated by \`rig completion zsh\`.

() {
  zstyle ':completion:*:rig:*:descriptions' format $'\\e[1;34m%d\\e[0m'
  zstyle ':completion:*:rig:*' group-name ''
  zstyle ':completion:*:rig:*' verbose true
}

_rig() {
  local raw line value description marker group key tag
  local -A bucket_specs bucket_groups bucket_data
  raw=("\${(@f)$(command rig __complete --shell zsh --index $((CURRENT - 1)) -- "\${words[@]}" 2>/dev/null)}")

  for line in "\${raw[@]}"; do
    [[ -z "$line" ]] && continue
    local -a parts
    parts=("\${(@s:	:)line}")
    value="\${parts[1]}"
    description="\${parts[2]:-}"
    marker="\${parts[3]:-}"
    group="\${parts[4]:-}"
    [[ -z "$group" ]] && group="rig"
    key="\${group}|\${marker}"
    bucket_groups[$key]="$group"
    bucket_specs[$key]="$marker"
    if [[ -n "$description" ]]; then
      bucket_data[$key]+="\${value}:\${description}"$'\\n'
    else
      bucket_data[$key]+="\${value}"$'\\n'
    fi
  done

  for key in "\${(@k)bucket_data}"; do
    local -a matches
    matches=("\${(@f)bucket_data[$key]}")
    matches=("\${(@)matches:#}")
    tag="\${bucket_groups[$key]//[^A-Za-z0-9]/_}"
    [[ -z "$tag" ]] && tag="rig"
    if [[ "\${bucket_specs[$key]}" == "nospace" ]]; then
      _describe -t "$tag" "\${bucket_groups[$key]}" matches -S ''
    else
      _describe -t "$tag" "\${bucket_groups[$key]}" matches
    fi
  done
}

compdef _rig rig
`;
}

function parseInlineValueOption(current: string): { option: string; value: string; prefix: string } | undefined {
  const index = current.indexOf("=");
  if (index < 0) return undefined;
  return {
    option: current.slice(0, index),
    value: current.slice(index + 1),
    prefix: current.slice(0, index + 1),
  };
}

function parseRunArgs(context: CompletionContext): { workspace?: string; operation?: string; args: string[] } {
  const basePositionals = positionalTokensFrom(context.argsBefore, COMMAND_OPTIONS.run);
  const workspace = basePositionals[0]?.value;
  const operation = basePositionals[1]?.value;
  const operationTokenIndex = basePositionals[1]?.index;
  return {
    workspace,
    operation,
    args: operationTokenIndex === undefined ? [] : context.argsBefore.slice(operationTokenIndex + 1),
  };
}

function parseRmArgs(context: CompletionContext): { workspace?: string } {
  const positionals = positionalsFrom(context.argsBefore, COMMAND_OPTIONS.rm);
  return { workspace: positionals[0] };
}

function parseCacheArgs(context: CompletionContext): { subcommand?: string; args: string[] } {
  const positionals = positionalsFrom(context.argsBefore, COMMAND_OPTIONS.cache);
  return {
    subcommand: positionals[0],
    args: positionals.slice(1),
  };
}

function parseProvidersArgs(context: CompletionContext): { provider?: string; subcommand?: string; args: string[] } {
  const positionals = positionalsFrom(context.argsBefore, COMMAND_OPTIONS.providers);
  return {
    provider: positionals[0],
    subcommand: positionals[1],
    args: positionals.slice(2),
  };
}

function positionalsFrom(tokens: string[], options: OptionDefinition[]): string[] {
  return positionalTokensFrom(tokens, options).map((token) => token.value);
}

function positionalTokensFrom(tokens: string[], options: OptionDefinition[]): Array<{ value: string; index: number }> {
  const positionalTokens: Array<{ value: string; index: number }> = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index]!;
    if (word === "--") {
      positionalTokens.push(...tokens.slice(index + 1).map((value, offset) => ({ value, index: index + 1 + offset })));
      break;
    }

    const option = findOption(options, word) ?? findOption(GLOBAL_OPTIONS, word);
    if (option && isOptionToken(word)) {
      if (option.takesValue && !hasInlineValue(word)) index += 1;
      continue;
    }

    if (isOptionToken(word)) continue;
    positionalTokens.push({ value: word, index });
  }

  return positionalTokens;
}

function operationOptions(operation: RuntimeOperationDefinition | undefined): OptionDefinition[] {
  if (!operation) return [];
  return inferOperationOptions(operation).map((runtimeOption) =>
    option([runtimeOption.flag, ...(runtimeOption.aliases ?? [])], optionDescription(operation, runtimeOption), {
      takesValue: runtimeOption.type !== "boolean",
      operation,
      runtimeOption,
    })
  );
}

function inferOperationOptions(operation: RuntimeOperationDefinition): RuntimeOperationCliOption[] {
  const properties = operation.inputSchema?.properties ?? {};
  const runtimeOptions = operation.cli?.options ?? Object.entries(properties).map(([name, schema]) => ({
    name,
    flag: `--${dashCase(name)}`,
    required: operation.inputSchema?.required?.includes(name),
    type: schema.type === "boolean" ? "boolean" : schema.type === "number" ? "number" : "string",
  } satisfies RuntimeOperationCliOption));

  return runtimeOptions.map((runtimeOption) => ({
    ...runtimeOption,
    type: runtimeOption.type ?? schemaType(properties[runtimeOption.name]) ?? "string",
  }));
}

function operationPositionalValueItems(
  operation: RuntimeOperationDefinition,
  positionalIndex: number,
  current: string,
): CompletionItem[] {
  const positionals = operation.cli?.positionals ?? [];
  const positional = positionals.find((item) => item.index === positionalIndex);
  if (!positional) return [];

  const schema = operation.inputSchema?.properties?.[positional.name];
  const enumItems = enumCompletionItems(schema);
  return filterItems(enumItems, current);
}

function optionDescription(operation: RuntimeOperationDefinition, option: RuntimeOperationCliOption): string {
  const schemaDescription = operation.inputSchema?.properties?.[option.name]?.description;
  if (schemaDescription) return schemaDescription;
  return option.required ? `${option.name} (required)` : option.name;
}

function schemaType(schema: JsonSchemaProperty | undefined): RuntimeOperationCliOption["type"] | undefined {
  if (schema?.type === "boolean" || schema?.type === "number" || schema?.type === "string") return schema.type;
  return undefined;
}

function enumCompletionItems(schema: JsonSchemaProperty | undefined): CompletionItem[] {
  const values = schema?.enum ?? [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => ({ value, group: GROUP_VALUES }));
}

function optionItems(options: OptionDefinition[]): CompletionItem[] {
  return dedupeItems(options.flatMap((option) =>
    (option.completions ?? option.flags.map((value): { value: string; noSpace?: boolean } => ({ value }))).map((completion) => ({
      value: completion.value,
      description: option.description,
      noSpace: completion.noSpace,
      group: option.group,
    }))
  ));
}

function mergeOptions(options: OptionDefinition[]): OptionDefinition[] {
  const seen = new Set<string>();
  const merged: OptionDefinition[] = [];
  for (const option of options) {
    const key = option.flags.join("\0");
    if (option.flags.some((flag) => seen.has(flag))) continue;
    for (const flag of option.flags) seen.add(flag);
    seen.add(key);
    merged.push(option);
  }
  return merged;
}

function findOption(options: OptionDefinition[], word: string): OptionDefinition | undefined {
  const flag = optionFlag(word);
  return options.find((option) => option.flags.includes(flag));
}

function optionFlag(word: string): string {
  const index = word.indexOf("=");
  return index < 0 ? word : word.slice(0, index);
}

function hasInlineValue(word: string): boolean {
  return word.includes("=");
}

function isOptionToken(word: string): boolean {
  return word.startsWith("-") && word !== "-";
}

function isCommandName(value: string): value is CommandName {
  return COMMAND_NAMES.has(value as CommandName);
}

function resolveProjectDir(words: string[], cwd: string): { projectDir: string; configPath: string } {
  let chdir: string | undefined;
  let config: string | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "--chdir") {
      chdir = words[index + 1];
      index += 1;
      continue;
    }
    if (word.startsWith("--chdir=")) {
      chdir = word.slice("--chdir=".length);
      continue;
    }
    if (word === "--config") {
      config = words[index + 1];
      index += 1;
      continue;
    }
    if (word.startsWith("--config=")) {
      config = word.slice("--config=".length);
      continue;
    }
  }

  const baseDir = resolve(cwd, chdir ?? ".");
  if (config) {
    const configPath = resolve(baseDir, config);
    return { projectDir: projectDirForConfigPath(configPath), configPath };
  }
  return projectPaths(baseDir);
}

function projectBaseDir(words: string[], cwd: string): string {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "--chdir") {
      const value = words[index + 1];
      if (value) return resolve(cwd, value);
    }
    if (word.startsWith("--chdir=")) {
      return resolve(cwd, word.slice("--chdir=".length));
    }
  }
  return cwd;
}

function projectPaths(projectDir: string): { projectDir: string; configPath: string } {
  return { projectDir, configPath: join(projectDir, DEFAULT_CONFIG_PATH) };
}

function completeDirectories(baseDir: string, current: string): CompletionItem[] {
  return completePathEntries(baseDir, current, {
    includeFiles: false,
    includeDirectories: true,
  });
}

function completeConfigPaths(baseDir: string, current: string): CompletionItem[] {
  return completePathEntries(baseDir, current, {
    includeFiles: true,
    includeDirectories: true,
    fileFilter: (name) => name === DEFAULT_CONFIG_FILE,
  });
}

function completeFilesystemPaths(baseDir: string, current: string): CompletionItem[] {
  return completePathEntries(baseDir, current, {
    includeFiles: true,
    includeDirectories: true,
  });
}

function completePathEntries(
  baseDir: string,
  current: string,
  options: {
    includeFiles: boolean;
    includeDirectories: boolean;
    fileFilter?: (name: string) => boolean;
  },
): CompletionItem[] {
  const { dirPart, namePrefix, dir } = splitCompletionPath(baseDir, current);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items = entries
    .filter((entry) => entry.name.startsWith(namePrefix))
    .flatMap((entry): CompletionItem[] => {
      if (entry.isDirectory()) {
        if (!options.includeDirectories) return [];
        if (shouldSkipCompletionDirectory(entry.name, namePrefix)) return [];
        return [{
          value: `${dirPart}${entry.name}/`,
          description: "directory",
          noSpace: true,
          group: GROUP_PATHS,
        }];
      }

      if (!entry.isFile() || !options.includeFiles) return [];
      if (options.fileFilter && !options.fileFilter(entry.name)) return [];
      return [{
        value: `${dirPart}${entry.name}`,
        description: options.fileFilter ? "config" : "file",
        group: GROUP_PATHS,
      }];
    })
    .sort((left, right) => {
      if (left.noSpace && !right.noSpace) return -1;
      if (!left.noSpace && right.noSpace) return 1;
      return left.value.localeCompare(right.value);
    });

  return dedupeItems(items);
}

function shouldSkipCompletionDirectory(name: string, namePrefix: string): boolean {
  if (
    name === ".git" ||
    name === ".rigkit" ||
    name === ".turbo" ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build"
  ) {
    return true;
  }
  return name.startsWith(".") && !namePrefix.startsWith(".");
}

function splitCompletionPath(baseDir: string, current: string): {
  dirPart: string;
  namePrefix: string;
  dir: string;
} {
  const slashIndex = current.lastIndexOf("/");
  const dirPart = slashIndex >= 0 ? current.slice(0, slashIndex + 1) : "";
  const namePrefix = slashIndex >= 0 ? current.slice(slashIndex + 1) : current;
  return {
    dirPart,
    namePrefix,
    dir: resolve(baseDir, dirPart || "."),
  };
}

async function safeWorkspaceTargets(
  paths: { projectDir: string; configPath: string },
): Promise<CompletionItem[]> {
  try {
    const workspaces = await readWorkspaces(paths);
    return dedupeItems(workspaces.map((workspace) => ({
      value: workspace.name,
      description: workspaceDescription(workspace),
      group: GROUP_WORKSPACES,
    })));
  } catch {
    return [];
  }
}

async function readWorkspaces(paths: { projectDir: string; configPath: string }): Promise<RuntimeWorkspaceCompletion[]> {
  const runtime = await getOrStartRuntime(paths);
  const { workspaces } = await runtime.control.workspaces();
  return workspaces.map((workspace) => ({
    name: workspace.name,
    workflow: workspace.workflow,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }));
}

async function safeWorkflowTargets(
  paths: { projectDir: string; configPath: string },
): Promise<CompletionItem[]> {
  try {
    const runtime = await getOrStartRuntime(paths);
    const { workflows } = await runtime.control.workflows();
    return workflows.map((workflow) => ({
      value: workflow.name,
      description: "workflow",
      group: GROUP_VALUES,
    }));
  } catch {
    return [];
  }
}

async function safeWorkspaceOperationTargets(
  paths: { projectDir: string; configPath: string },
): Promise<CompletionItem[]> {
  try {
    const manifest = await readOperations(paths);
    return workspaceOperationTargets(manifest);
  } catch {
    return [];
  }
}

function workspaceOperationTargets(manifest: RuntimeOperationManifest): CompletionItem[] {
  return dedupeItems((manifest.workspaceOperations ?? []).flatMap((operation) => [
    {
      value: operation.id,
      description: operation.description || "workspace operation",
      group: GROUP_OPERATIONS,
    },
    ...(operation.aliases ?? []).map((alias) => ({
      value: alias,
      description: operation.description || "workspace operation",
      group: GROUP_OPERATIONS,
    })),
  ]));
}

async function safeCacheInvalidateTargets(
  paths: { projectDir: string; configPath: string },
): Promise<CompletionItem[]> {
  try {
    const runtime = await getOrStartRuntime(paths);
    const cache = await runtime.control.cache() as unknown as { entries: readonly RuntimeCacheCompletionEntry[] };
    return dedupeItems(cache.entries
      .filter((entry) => entry.scope === "local" && !entry.invalidated)
      .map((entry) => ({
        value: entry.nodePath || entry.nodeName,
        description: entry.workflow ? `workflow ${entry.workflow}` : "cached task",
        group: GROUP_CACHE,
      })));
  } catch {
    return [];
  }
}

async function resolveRuntimeOperation(
  paths: { projectDir: string; configPath: string },
  operationId: string,
): Promise<RuntimeOperationDefinition | undefined> {
  const manifest = await readOperations(paths);
  return manifest.operations.find((operation) =>
    operation.id === operationId || operation.aliases?.includes(operationId)
  );
}

async function safeResolveRuntimeOperation(
  paths: { projectDir: string; configPath: string },
  operationId: string,
): Promise<RuntimeOperationDefinition | undefined> {
  try {
    return await resolveRuntimeOperation(paths, operationId);
  } catch {
    return undefined;
  }
}

async function resolveWorkspaceOperation(
  paths: { projectDir: string; configPath: string },
  operationId: string,
): Promise<RuntimeOperationDefinition | undefined> {
  const manifest = await readOperations(paths);
  return (manifest.workspaceOperations ?? []).find((operation) =>
    operation.id === operationId || operation.aliases?.includes(operationId)
  );
}

async function safeResolveWorkspaceOperation(
  paths: { projectDir: string; configPath: string },
  operationId: string,
): Promise<RuntimeOperationDefinition | undefined> {
  try {
    return await resolveWorkspaceOperation(paths, operationId);
  } catch {
    return undefined;
  }
}

async function readOperations(paths: { projectDir: string; configPath: string }): Promise<RuntimeOperationManifest> {
  const runtime = await getOrStartRuntime(paths);
  return await runtime.control.operations() as unknown as RuntimeOperationManifest;
}

function filterItems(items: CompletionItem[], current: string): CompletionItem[] {
  return dedupeItems(items).filter((item) => item.value.startsWith(current));
}

function dedupeItems(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  const deduped: CompletionItem[] = [];
  for (const item of items) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    deduped.push(item);
  }
  return deduped;
}

function workspaceDescription(workspace: RuntimeWorkspaceCompletion): string {
  const age = formatWorkspaceAge(workspace.createdAt);
  return age ? `created ${age}` : "created date unknown";
}

export function formatWorkspaceAge(createdAt: string, nowMs = Date.now()): string | undefined {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return undefined;

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - createdAtMs) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays}d ago`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 24) return `${elapsedMonths}mo ago`;

  return `${Math.floor(elapsedMonths / 12)}y ago`;
}

function dashCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
