import { dirname, join, resolve } from "node:path";
import { getOrStartRuntime } from "@rigkit/runtime-client";

export type CompletionShell = "bash" | "fish" | "zsh";

export type CompletionItem = {
  value: string;
  description?: string;
};

type CompleteRigInput = {
  words: string[];
  currentIndex?: number;
  cwd?: string;
};

const COMMANDS: CompletionItem[] = [
  { value: "help", description: "show CLI help" },
  { value: "init", description: "initialize a Rigkit project" },
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
  operation: [
    { value: "--all", description: "run against every discovered project" },
    { value: "--discover", description: "discover projects below the selected directory" },
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

export async function completeRig(input: CompleteRigInput): Promise<CompletionItem[]> {
  const cwd = input.cwd ?? process.cwd();
  const words = input.words.length > 0 ? input.words : ["rig"];
  const currentIndex = input.currentIndex ?? Math.max(0, words.length - 1);
  const current = words[currentIndex] ?? "";
  const before = words.slice(1, currentIndex);
  const command = findCommand(before);

  if (expectsOptionValue(before)) return [];

  if (!command) {
    const rootOperation = parseRootOperation(before);
    if (rootOperation.operation) {
      if (current.startsWith("-")) {
        const operation = await safeResolveRuntimeOperation(resolveProjectDir(words, cwd), rootOperation.operation);
        return filterItems([
          ...(operation?.cli?.options ?? []).flatMap((option) => [
            { value: option.flag, description: option.name },
            ...(option.aliases ?? []).map((alias) => ({ value: alias, description: option.name })),
          ]),
          ...COMMAND_OPTIONS.operation,
          ...GLOBAL_OPTIONS,
        ], current);
      }
      const operation = await safeResolveRuntimeOperation(resolveProjectDir(words, cwd), rootOperation.operation);
      const operationPositionalCount = countRunOperationPositionals(rootOperation.args);
      const positional = operation?.cli?.positionals?.find((item) => item.index === operationPositionalCount);
      if (positional && /workspace|vm/i.test(positional.name)) {
        return filterItems(await workspaceTargets(resolveProjectDir(words, cwd), current, /vm/i.test(positional.name)), current);
      }
      return [];
    }
    return filterItems(current.startsWith("-") ? GLOBAL_OPTIONS : [...COMMANDS, ...await safeOperationTargets(resolveProjectDir(words, cwd)), ...GLOBAL_OPTIONS], current);
  }

  if (current.startsWith("-")) {
    if (command === "run") {
      const run = parseRunCommand(before);
      if (run.operation) {
        const operation = await safeResolveRuntimeOperation(resolveProjectDir(words, cwd), run.operation);
        return filterItems([
          ...(operation?.cli?.options ?? []).flatMap((option) => [
            { value: option.flag, description: option.name },
            ...(option.aliases ?? []).map((alias) => ({ value: alias, description: option.name })),
          ]),
          ...COMMAND_OPTIONS.operation,
          ...GLOBAL_OPTIONS,
        ], current);
      }
    }
    return filterItems([...(COMMAND_OPTIONS[command] ?? []), ...GLOBAL_OPTIONS], current);
  }

  const positionalCount = countPositionals(before, command);

  if (command === "run") {
    const run = parseRunCommand(before);
    if (!run.operation) {
      return filterItems(await safeOperationTargets(resolveProjectDir(words, cwd)), current);
    }
    const operation = await safeResolveRuntimeOperation(resolveProjectDir(words, cwd), run.operation);
    const operationPositionalCount = countRunOperationPositionals(run.args);
    const positional = operation?.cli?.positionals?.find((item) => item.index === operationPositionalCount);
    if (positional && /workspace|vm/i.test(positional.name)) {
      return filterItems(await workspaceTargets(resolveProjectDir(words, cwd), current, /vm/i.test(positional.name)), current);
    }
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
  local -a raw completions
  local line value description
  raw=("\${(@f)$(command rig __complete --shell zsh --index $((CURRENT - 1)) -- "\${words[@]}" 2>/dev/null)}")
  for line in "\${raw[@]}"; do
    value="\${line%%$'\\t'*}"
    if [[ "$line" == *$'\\t'* ]]; then
      description="\${line#*$'\\t'}"
      completions+=("\${value}:\${description}")
    else
      completions+=("\${value}")
    fi
  done
  _describe 'rig' completions
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

function parseRunCommand(words: string[]): { operation?: string; args: string[] } {
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
  return { operation: args[0], args: args.slice(1) };
}

function parseRootOperation(words: string[]): { operation?: string; args: string[] } {
  const args: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (OPTIONS_WITH_VALUES.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("--") && word.includes("=")) continue;
    if (word.startsWith("-")) continue;
    args.push(word);
  }
  return { operation: args[0], args: args.slice(1) };
}

function countRunOperationPositionals(args: string[]): number {
  let count = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (OPTIONS_WITH_VALUES.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--") && arg.includes("=")) continue;
    if (arg.startsWith("-")) continue;
    count += 1;
  }
  return count;
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
  current: string,
  includeVmIds: boolean,
): Promise<CompletionItem[]> {
  const workspaces = await readWorkspaces(paths);
  const items = workspaces.map((workspace) => ({
    value: workspace.name,
    description: workspace.resourceId,
  }));

  if (includeVmIds && current.length > 0) {
    for (const workspace of workspaces) {
      if (!workspace.resourceId) continue;
      items.push({
        value: workspace.resourceId,
        description: workspace.name,
      });
    }
  }

  return dedupeItems(items);
}

async function readWorkspaces(paths: { projectDir: string; configPath: string }): Promise<Array<{ name: string; resourceId?: string }>> {
  const runtime = await getOrStartRuntime(paths);
  const { workspaces } = await runtime.control.workspaces();
  return workspaces.map((workspace) => ({
    name: workspace.name,
    resourceId: workspaceDisplayResourceId(workspace),
  }));
}

function workspaceDisplayResourceId(
  workspace: { resourceId?: string; resources?: Record<string, { resourceId: string }> },
): string | undefined {
  const resources = workspace.resources ?? {};
  const resource = resources.default ?? resources.vm;
  if (resource) return resource.resourceId;
  const values = Object.values(resources);
  if (values.length === 1) return values[0]?.resourceId;
  return workspace.resourceId;
}

async function operationTargets(paths: { projectDir: string; configPath: string }): Promise<CompletionItem[]> {
  const manifest = await readOperations(paths);
  return manifest.operations.flatMap((operation) => [
    { value: operation.id, description: operation.description },
    ...(operation.aliases ?? []).map((alias) => ({ value: alias, description: operation.description })),
  ]);
}

async function safeOperationTargets(paths: { projectDir: string; configPath: string }): Promise<CompletionItem[]> {
  try {
    return await operationTargets(paths);
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
