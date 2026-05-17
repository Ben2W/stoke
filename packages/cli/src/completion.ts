import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getOrStartRuntime } from "@rigkit/runtime-client";
import { isRigConfigFileName } from "./project.ts";

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
  { value: "projects", description: "discover Rigkit projects" },
  { value: "doctor", description: "show runtime diagnostics" },
  { value: "version", description: "show CLI version" },
  { value: "completion", description: "generate shell completion" },
]);

const COMMAND_ALIASES = new Map<string, string>();

const GLOBAL_OPTIONS: CompletionItem[] = withGroup(GROUP_GLOBAL, [
  { value: "-chdir=", description: "working directory", noSpace: true },
  { value: "-config=", description: "config file", noSpace: true },
  { value: "-state=", description: "state database path", noSpace: true },
  { value: "-json", description: "print JSON" },
  { value: "-help", description: "show help" },
  { value: "-version", description: "show version" },
]);

const COMMAND_OPTIONS: Record<string, CompletionItem[]> = {
  init: withGroup(GROUP_FLAGS, [
    { value: "--name", description: "project and workflow name" },
    { value: "--api-key", description: "Freestyle API key" },
    { value: "--package-manager", description: "npm, bun, pnpm, or skip" },
    { value: "--force", description: "overwrite existing config" },
    { value: "--json", description: "print JSON" },
  ]),
  plan: withGroup(GROUP_FLAGS, [
    { value: "--all", description: "run against every discovered project" },
    { value: "--discover", description: "discover projects below the selected directory" },
    { value: "--json", description: "print JSON" },
  ]),
  apply: withGroup(GROUP_FLAGS, [
    { value: "--all", description: "run against every discovered project" },
    { value: "--discover", description: "discover projects below the selected directory" },
    { value: "--json", description: "print JSON" },
  ]),
  create: withGroup(GROUP_FLAGS, [
    { value: "--json", description: "print JSON" },
  ]),
  rm: withGroup(GROUP_FLAGS, [
    { value: "-y", description: "skip confirmation" },
    { value: "--yes", description: "skip confirmation" },
    { value: "--json", description: "print JSON" },
  ]),
  run: withGroup(GROUP_FLAGS, [
    { value: "--json", description: "print JSON" },
  ]),
  ls: [
    ...withGroup(GROUP_TARGETS, [
      { value: "workspaces", description: "list workspaces" },
      { value: "snapshots", description: "list snapshots" },
      { value: "config", description: "show project config" },
    ]),
    ...withGroup(GROUP_FLAGS, [
      { value: "--json", description: "print JSON" },
    ]),
  ],
  projects: withGroup(GROUP_FLAGS, [
    { value: "--json", description: "print JSON" },
  ]),
  cache: withGroup(GROUP_SUBCOMMANDS, [
    { value: "ls", description: "list cache entries" },
    { value: "clear", description: "clear cache entries" },
  ]),
  completion: withGroup(GROUP_SHELLS, [
    { value: "bash", description: "Bash completion" },
    { value: "fish", description: "fish completion" },
    { value: "zsh", description: "zsh completion" },
  ]),
};

const CACHE_SUBCOMMAND_OPTIONS: Record<string, CompletionItem[]> = {
  ls: withGroup(GROUP_FLAGS, [
    { value: "--json", description: "print JSON" },
  ]),
  clear: withGroup(GROUP_FLAGS, [
    { value: "--local", description: "clear local cache entries" },
    { value: "--global", description: "clear global cache fragments" },
    { value: "--all", description: "clear every global fragment" },
    { value: "--json", description: "print JSON" },
  ]),
};

function withGroup(group: string, items: Omit<CompletionItem, "group">[]): CompletionItem[] {
  return items.map((item) => ({ ...item, group }));
}

const PROJECT_OPERATION_COMMANDS = new Set(["plan", "apply", "create"]);

const OPTIONS_WITH_VALUES = new Set([
  "-chdir",
  "--chdir",
  "-config",
  "--config",
  "-state",
  "--state",
  "--name",
  "--api-key",
  "--package-manager",
]);

type RuntimeOperationManifest = {
  operations: RuntimeOperationDefinition[];
  workspaceOperations?: RuntimeOperationDefinition[];
};

type RuntimeOperationDefinition = {
  id: string;
  aliases?: string[];
  description?: string;
  cli?: {
    positionals?: Array<{ name: string; index: number }>;
    options?: Array<{ name: string; flag: string; aliases?: string[]; runtime?: boolean; type?: string }>;
  };
};

type RuntimeWorkspaceCompletion = {
  name: string;
  workflow: string;
  createdAt: string;
  updatedAt: string;
};

export async function completeRig(input: CompleteRigInput): Promise<CompletionItem[]> {
  const cwd = input.cwd ?? process.cwd();
  const words = input.words.length > 0 ? input.words : ["rig"];
  const currentIndex = input.currentIndex ?? Math.max(0, words.length - 1);
  const current = words[currentIndex] ?? "";
  const before = words.slice(1, currentIndex);
  const command = findCommand(before);

  const inlineOption = parseInlineValueOption(current);
  if (inlineOption) {
    return await completeOptionValue({
      option: inlineOption.option,
      current: inlineOption.value,
      cwd,
      words,
      inlinePrefix: inlineOption.prefix,
    });
  }

  const valueOption = optionExpectingValue(before);
  if (valueOption) {
    return await completeOptionValue({
      option: valueOption,
      current,
      cwd,
      words,
    });
  }

  if (!command) {
    return filterItems(
      current.startsWith("-")
        ? GLOBAL_OPTIONS
        : [...COMMANDS, ...GLOBAL_OPTIONS],
      current,
    );
  }

  if (current.startsWith("-")) {
    if (command === "rm") {
      const remove = parseRemoveCommand(before);
      if (remove.workspace) {
        const operation = await safeResolveWorkspaceOperation(resolveProjectDir(words, cwd), "remove");
        return filterItems([
          ...(operation?.cli?.options ?? []).flatMap((option) => [
            { value: option.flag, description: option.name, group: GROUP_FLAGS },
            ...(option.aliases ?? []).map((alias) => ({ value: alias, description: option.name, group: GROUP_FLAGS })),
          ]),
          ...COMMAND_OPTIONS.rm,
          ...GLOBAL_OPTIONS,
        ], current);
      }
    }
    if (command === "run") {
      const run = parseWorkspaceRunCommand(before);
      if (run.workspace && run.operation) {
        const operation = await safeResolveWorkspaceOperation(resolveProjectDir(words, cwd), run.operation);
        return filterItems([
          ...(operation?.cli?.options ?? []).flatMap((option) => [
            { value: option.flag, description: option.name, group: GROUP_FLAGS },
            ...(option.aliases ?? []).map((alias) => ({ value: alias, description: option.name, group: GROUP_FLAGS })),
          ]),
          ...COMMAND_OPTIONS.run,
          ...GLOBAL_OPTIONS,
        ], current);
      }
    }
    if (PROJECT_OPERATION_COMMANDS.has(command)) {
      const operation = await safeResolveRuntimeOperation(resolveProjectDir(words, cwd), command);
      return filterItems([
        ...(operation?.cli?.options ?? []).flatMap((option) => [
          { value: option.flag, description: option.name },
          ...(option.aliases ?? []).map((alias) => ({ value: alias, description: option.name })),
        ]),
        ...(COMMAND_OPTIONS[command] ?? []),
        ...GLOBAL_OPTIONS,
      ], current);
    }
    if (command === "cache") {
      return filterItems([
        ...cacheOptionTargets(before),
        ...GLOBAL_OPTIONS,
      ], current);
    }
    return filterItems([...(COMMAND_OPTIONS[command] ?? []), ...GLOBAL_OPTIONS], current);
  }

  const positionalCount = countPositionals(before, command);

  if (command === "run") {
    const run = parseWorkspaceRunCommand(before);
    if (!run.workspace) return filterItems(await workspaceTargets(resolveProjectDir(words, cwd)), current);
    if (!run.operation) return filterItems(await safeWorkspaceOperationTargets(resolveProjectDir(words, cwd)), current);
  }

  if (command === "rm") {
    const remove = parseRemoveCommand(before);
    if (!remove.workspace) return filterItems(await workspaceTargets(resolveProjectDir(words, cwd)), current);
  }

  if (command === "completion" && positionalCount === 0) {
    return filterItems(COMMAND_OPTIONS.completion, current);
  }

  if (command === "ls" && positionalCount === 0) {
    return filterItems(COMMAND_OPTIONS.ls, current);
  }

  if (command === "cache") {
    const cache = parseCacheCommand(before);
    if (!cache.subcommand) return filterItems(COMMAND_OPTIONS.cache ?? [], current);
    return filterItems(cacheOptionTargets(before), current);
  }

  return [];
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
    // fish: legacy two-column format works fine; descriptions render dim by default
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
# rig zsh completion — auto-generated by \`rig completion zsh\`.
# Visual defaults are scoped to :completion:*:rig:* so they don't override your
# global completion theme. Group headers render bold blue; descriptions inherit
# your usual style.

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

function findCommand(words: string[]): string | undefined {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (OPTIONS_WITH_VALUES.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("--") && word.includes("=")) continue;
    if (word.startsWith("-")) continue;

    const canonical = COMMAND_ALIASES.get(word) ?? word;
    if (COMMANDS.some((command) => command.value === canonical)) return canonical;
  }
  return undefined;
}

function countPositionals(words: string[], command: string): number {
  let foundCommand = false;
  let count = 0;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (OPTIONS_WITH_VALUES.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("--") && word.includes("=")) continue;
    if (word.startsWith("-")) continue;

    const canonical = COMMAND_ALIASES.get(word) ?? word;
    if (!foundCommand && canonical === command) {
      foundCommand = true;
      continue;
    }
    if (foundCommand) count += 1;
  }

  return count;
}

function parseWorkspaceRunCommand(words: string[]): { workspace?: string; operation?: string; args: string[] } {
  let foundRun = false;
  const args: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (OPTIONS_WITH_VALUES.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("--") && word.includes("=")) continue;
    if (word.startsWith("-")) continue;
    if (!foundRun) {
      if (word === "run") foundRun = true;
      continue;
    }
    args.push(word);
  }
  return { workspace: args[0], operation: args[1], args: args.slice(2) };
}

function parseRemoveCommand(words: string[]): { workspace?: string; args: string[] } {
  let foundRemove = false;
  const args: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (OPTIONS_WITH_VALUES.has(word)) {
      index += 1;
      continue;
    }
    if (word.includes("=") && OPTIONS_WITH_VALUES.has(word.slice(0, word.indexOf("=")))) continue;
    if (word.startsWith("-")) continue;
    if (!foundRemove) {
      if (word === "rm") foundRemove = true;
      continue;
    }
    args.push(word);
  }
  return { workspace: args[0], args: args.slice(1) };
}

function parseCacheCommand(words: string[]): { subcommand?: string; args: string[] } {
  let foundCache = false;
  const args: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (OPTIONS_WITH_VALUES.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("--") && word.includes("=")) continue;
    if (word.startsWith("-")) continue;
    if (!foundCache) {
      if (word === "cache") foundCache = true;
      continue;
    }
    args.push(word);
  }
  return { subcommand: args[0], args: args.slice(1) };
}

function cacheOptionTargets(words: string[]): CompletionItem[] {
  const subcommand = parseCacheCommand(words).subcommand;
  return subcommand ? CACHE_SUBCOMMAND_OPTIONS[subcommand] ?? [] : [];
}

function optionExpectingValue(words: string[]): string | undefined {
  const previous = words.at(-1);
  return previous && OPTIONS_WITH_VALUES.has(previous) ? previous : undefined;
}

async function completeOptionValue(input: {
  option: string;
  current: string;
  cwd: string;
  words: string[];
  inlinePrefix?: string;
}): Promise<CompletionItem[]> {
  let items: CompletionItem[];
  switch (input.option) {
    case "-chdir":
    case "--chdir":
      items = completeDirectories(input.cwd, input.current);
      break;
    case "-config":
    case "--config":
      items = completeConfigPaths(projectBaseDir(input.words, input.cwd), input.current);
      break;
    case "--package-manager":
      items = filterItems([
        { value: "npm", group: GROUP_VALUES },
        { value: "bun", group: GROUP_VALUES },
        { value: "pnpm", group: GROUP_VALUES },
        { value: "skip", group: GROUP_VALUES },
      ], input.current);
      break;
    case "-state":
    case "--state":
      items = completeFilesystemPaths(input.cwd, input.current);
      break;
    default:
      items = [];
  }

  if (!input.inlinePrefix) return items;
  return items.map((item) => ({
    ...item,
    value: `${input.inlinePrefix}${item.value}`,
  }));
}

function parseInlineValueOption(current: string): { option: string; value: string; prefix: string } | undefined {
  const index = current.indexOf("=");
  if (index < 0) return undefined;
  const option = current.slice(0, index);
  if (!OPTIONS_WITH_VALUES.has(option)) return undefined;
  return {
    option,
    value: current.slice(index + 1),
    prefix: current.slice(0, index + 1),
  };
}

function resolveProjectDir(words: string[], cwd: string): { projectDir: string; configPath: string } {
  let chdir: string | undefined;
  let config: string | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "-chdir" || word === "--chdir") {
      chdir = words[index + 1];
      index += 1;
      continue;
    }
    if (word.startsWith("-chdir=")) {
      chdir = word.slice("-chdir=".length);
      continue;
    }
    if (word.startsWith("--chdir=")) {
      chdir = word.slice("--chdir=".length);
      continue;
    }
    if (word === "-config" || word === "--config") {
      config = words[index + 1];
      index += 1;
      continue;
    }
    if (word.startsWith("-config=")) {
      config = word.slice("-config=".length);
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
    return { projectDir: dirname(configPath), configPath };
  }
  return projectPaths(baseDir);
}

function projectBaseDir(words: string[], cwd: string): string {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "-chdir" || word === "--chdir") {
      const value = words[index + 1];
      if (value) return resolve(cwd, value);
    }
    if (word.startsWith("-chdir=")) {
      return resolve(cwd, word.slice("-chdir=".length));
    }
    if (word.startsWith("--chdir=")) {
      return resolve(cwd, word.slice("--chdir=".length));
    }
  }
  return cwd;
}

function projectPaths(projectDir: string): { projectDir: string; configPath: string } {
  return { projectDir, configPath: join(projectDir, "rig.config.ts") };
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
    fileFilter: isRigConfigFileName,
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
        description: "config",
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

async function workspaceTargets(
  paths: { projectDir: string; configPath: string },
): Promise<CompletionItem[]> {
  const workspaces = await readWorkspaces(paths);
  const items = workspaces.map((workspace) => ({
    value: workspace.name,
    description: workspaceDescription(workspace),
    group: GROUP_WORKSPACES,
  }));

  return dedupeItems(items);
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
  return (manifest.workspaceOperations ?? []).flatMap((operation) => [
    {
      value: operation.id,
      description: operation.description ?? "workspace operation",
      group: GROUP_OPERATIONS,
    },
    ...(operation.aliases ?? []).map((alias) => ({
      value: alias,
      description: operation.description ?? "workspace operation",
      group: GROUP_OPERATIONS,
    })),
  ]);
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
