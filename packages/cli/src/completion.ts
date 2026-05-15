import { dirname, join, resolve } from "node:path";
import { getOrStartRuntime } from "@rigkit/runtime-client";

export type CompletionShell = "bash" | "fish" | "zsh";

export type CompletionItem = {
  value: string;
  description?: string;
  noSpace?: boolean;
};

type CompleteRigInput = {
  words: string[];
  currentIndex?: number;
  cwd?: string;
};

const COMMANDS: CompletionItem[] = [
  { value: "help", description: "show CLI help" },
  { value: "init", description: "initialize a Rigkit project" },
  { value: "plan", description: "plan project workflow changes" },
  { value: "apply", description: "apply project workflow changes" },
  { value: "create", description: "create a workspace" },
  { value: "run", description: "run a workspace operation" },
  { value: "ls", description: "list project workspaces" },
  { value: "projects", description: "discover Rigkit projects" },
  { value: "doctor", description: "show runtime diagnostics" },
  { value: "version", description: "show CLI version" },
  { value: "completion", description: "generate shell completion" },
];

const COMMAND_ALIASES = new Map<string, string>();

const GLOBAL_OPTIONS: CompletionItem[] = [
  { value: "-C", description: "project directory" },
  { value: "--project", description: "project directory" },
  { value: "--config", description: "exact config file" },
  { value: "--state", description: "local state database path" },
  { value: "--json", description: "print JSON" },
  { value: "--help", description: "show help" },
  { value: "--version", description: "show version" },
];

const COMMAND_OPTIONS: Record<string, CompletionItem[]> = {
  init: [
    { value: "--name", description: "project and workflow name" },
    { value: "--api-key", description: "Freestyle API key" },
    { value: "--package-manager", description: "npm, bun, pnpm, or skip" },
    { value: "--force", description: "overwrite existing config" },
    { value: "--json", description: "print JSON" },
  ],
  plan: [
    { value: "--all", description: "run against every discovered project" },
    { value: "--discover", description: "discover projects below the selected directory" },
    { value: "--json", description: "print JSON" },
  ],
  apply: [
    { value: "--all", description: "run against every discovered project" },
    { value: "--discover", description: "discover projects below the selected directory" },
    { value: "--json", description: "print JSON" },
  ],
  create: [
    { value: "--json", description: "print JSON" },
  ],
  run: [
    { value: "--json", description: "print JSON" },
  ],
  ls: [
    { value: "workspaces", description: "list workspaces" },
    { value: "snapshots", description: "list snapshots" },
    { value: "config", description: "show project config" },
    { value: "--json", description: "print JSON" },
  ],
  projects: [
    { value: "--json", description: "print JSON" },
  ],
  completion: [
    { value: "bash", description: "Bash completion" },
    { value: "fish", description: "fish completion" },
    { value: "zsh", description: "zsh completion" },
  ],
};

const PROJECT_OPERATION_COMMANDS = new Set(["plan", "apply", "create"]);

const OPTIONS_WITH_VALUES = new Set([
  "-C",
  "--project",
  "--config",
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

  if (expectsOptionValue(before)) return [];

  if (!command) {
    return filterItems(
      current.startsWith("-")
        ? GLOBAL_OPTIONS
        : [...COMMANDS, ...GLOBAL_OPTIONS],
      current,
    );
  }

  if (current.startsWith("-")) {
    if (command === "run") {
      const run = parseWorkspaceRunCommand(before);
      if (run.workspace && run.operation) {
        const operation = await safeResolveWorkspaceOperation(resolveProjectDir(words, cwd), run.operation);
        return filterItems([
          ...(operation?.cli?.options ?? []).flatMap((option) => [
            { value: option.flag, description: option.name },
            ...(option.aliases ?? []).map((alias) => ({ value: alias, description: option.name })),
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
    return filterItems([...(COMMAND_OPTIONS[command] ?? []), ...GLOBAL_OPTIONS], current);
  }

  const positionalCount = countPositionals(before, command);

  if (command === "run") {
    const run = parseWorkspaceRunCommand(before);
    if (!run.workspace) return filterItems(await workspaceTargets(resolveProjectDir(words, cwd)), current);
    if (!run.operation) return filterItems(await safeWorkspaceOperationTargets(resolveProjectDir(words, cwd)), current);
  }

  if (command === "completion" && positionalCount === 0) {
    return filterItems(COMMAND_OPTIONS.completion, current);
  }

  if (command === "ls" && positionalCount === 0) {
    return filterItems(COMMAND_OPTIONS.ls, current);
  }

  return [];
}

export function formatCompletionItems(items: CompletionItem[], shell: CompletionShell): string {
  const lines = items.map((item) => {
    if (shell === "bash") return item.value;
    if (shell === "zsh" && item.noSpace) {
      return `${item.value}\t${item.description ?? ""}\tnospace`;
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
# rig zsh completion
_rig() {
  local -a raw values displays nospace_values nospace_displays
  local line value description rest marker display
  raw=("\${(@f)$(command rig __complete --shell zsh --index $((CURRENT - 1)) -- "\${words[@]}" 2>/dev/null)}")
  for line in "\${raw[@]}"; do
    value="\${line%%$'\\t'*}"
    description=""
    marker=""
    if [[ "$line" == *$'\\t'* ]]; then
      rest="\${line#*$'\\t'}"
      description="\${rest%%$'\\t'*}"
      if [[ "$rest" == *$'\\t'* ]]; then
        marker="\${rest#*$'\\t'}"
      fi
    fi
    display="\${value}"
    if [[ -n "$description" ]]; then
      display="\${value} -- \${description}"
    fi
    if [[ "$marker" == "nospace" ]]; then
      nospace_values+=("\${value}")
      nospace_displays+=("\${display}")
    else
      values+=("\${value}")
      displays+=("\${display}")
    fi
  done
  (( \${#nospace_values} )) && compadd -S '' -ld nospace_displays -a nospace_values
  (( \${#values} )) && compadd -ld displays -a values
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

function expectsOptionValue(words: string[]): boolean {
  const previous = words.at(-1);
  return Boolean(previous && OPTIONS_WITH_VALUES.has(previous));
}

function resolveProjectDir(words: string[], cwd: string): { projectDir: string; configPath: string } {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "-C" || word === "--project") {
      const value = words[index + 1];
      if (value) return projectPaths(resolve(cwd, value));
    }
    if (word.startsWith("--project=")) {
      return projectPaths(resolve(cwd, word.slice("--project=".length)));
    }
    if (word === "--config") {
      const value = words[index + 1];
      if (value) return { projectDir: dirname(resolve(cwd, value)), configPath: resolve(cwd, value) };
    }
    if (word.startsWith("--config=")) {
      const configPath = resolve(cwd, word.slice("--config=".length));
      return { projectDir: dirname(configPath), configPath };
    }
  }

  return projectPaths(cwd);
}

function projectPaths(projectDir: string): { projectDir: string; configPath: string } {
  return { projectDir, configPath: join(projectDir, "rig.config.ts") };
}

async function workspaceTargets(
  paths: { projectDir: string; configPath: string },
): Promise<CompletionItem[]> {
  const workspaces = await readWorkspaces(paths);
  const items = workspaces.map((workspace) => ({
    value: workspace.name,
    description: workspaceDescription(workspace),
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
    { value: operation.id, description: operation.description ?? "workspace operation" },
    ...(operation.aliases ?? []).map((alias) => ({
      value: alias,
      description: operation.description ?? "workspace operation",
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
