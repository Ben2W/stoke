import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

export type CompletionShell = "bash" | "fish" | "zsh";

export type CompletionItem = {
  value: string;
  description?: string;
};

type CompleteFdevInput = {
  words: string[];
  currentIndex?: number;
  cwd?: string;
};

const COMMANDS: CompletionItem[] = [
  { value: "init", description: "initialize an fdev project" },
  { value: "plan", description: "show cached and pending steps" },
  { value: "apply", description: "resolve the workflow" },
  { value: "fork", description: "create a workspace" },
  { value: "ls", description: "list workspaces, snapshots, or config" },
  { value: "ssh", description: "open SSH to a workspace or VM" },
  { value: "snapshot", description: "capture a workspace snapshot" },
  { value: "rm", description: "delete a workspace VM" },
  { value: "completion", description: "generate shell completion" },
];

const COMMAND_ALIASES = new Map([
  ["list", "ls"],
  ["terminal", "ssh"],
]);

const GLOBAL_OPTIONS: CompletionItem[] = [
  { value: "-C", description: "project directory" },
  { value: "--project", description: "project directory" },
  { value: "--config", description: "exact config file" },
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
  apply: [
    { value: "--dry-run", description: "show plan without running steps" },
    { value: "--json", description: "print JSON" },
  ],
  fork: [
    { value: "--name", description: "workspace name" },
    { value: "--json", description: "print JSON" },
  ],
  ls: [
    { value: "--json", description: "print JSON" },
  ],
  ssh: [
    { value: "--print", description: "print SSH command" },
    { value: "--user", description: "SSH user to allow" },
    { value: "--json", description: "print JSON" },
  ],
  snapshot: [
    { value: "--label", description: "snapshot label" },
    { value: "--json", description: "print JSON" },
  ],
  rm: [
    { value: "--yes", description: "confirm deletion" },
    { value: "-y", description: "confirm deletion" },
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
  "--name",
  "--api-key",
  "--package-manager",
  "--user",
  "--label",
]);

export function completeFdev(input: CompleteFdevInput): CompletionItem[] {
  const cwd = input.cwd ?? process.cwd();
  const words = input.words.length > 0 ? input.words : ["fdev"];
  const currentIndex = input.currentIndex ?? Math.max(0, words.length - 1);
  const current = words[currentIndex] ?? "";
  const before = words.slice(1, currentIndex);
  const command = findCommand(before);

  if (expectsOptionValue(before)) return [];

  if (!command) {
    return filterItems(current.startsWith("-") ? GLOBAL_OPTIONS : [...COMMANDS, ...GLOBAL_OPTIONS], current);
  }

  if (current.startsWith("-")) {
    return filterItems([...(COMMAND_OPTIONS[command] ?? []), ...GLOBAL_OPTIONS], current);
  }

  const positionalCount = countPositionals(before, command);

  if ((command === "ssh" || command === "snapshot" || command === "rm") && positionalCount === 0) {
    return filterItems(workspaceTargets(resolveProjectDir(words, cwd), current, command === "ssh"), current);
  }

  if (command === "ls" && positionalCount === 0) {
    return filterItems([
      { value: "workspaces", description: "workspaces" },
      { value: "snapshots", description: "cached node runs" },
      { value: "config", description: "loaded project config" },
    ], current);
  }

  if (command === "completion" && positionalCount === 0) {
    return filterItems(COMMAND_OPTIONS.completion, current);
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
    return `# fdev bash completion
_fdev_completion() {
  local completions
  completions="$(command fdev __complete --shell bash --index "$COMP_CWORD" -- "\${COMP_WORDS[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "$completions" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _fdev_completion fdev
`;
  }

  if (shell === "fish") {
    return `# fdev fish completion
function __fdev_complete
  set -l tokens (commandline -opc)
  set -l current (commandline -ct)
  set -l index (count $tokens)
  command fdev __complete --shell fish --index $index -- $tokens $current 2>/dev/null
end
complete -c fdev -f -a "(__fdev_complete)"
`;
  }

  return `#compdef fdev
# fdev zsh completion
_fdev() {
  local -a raw completions
  local line value description
  raw=("\${(@f)$(command fdev __complete --shell zsh --index $((CURRENT - 1)) -- "\${words[@]}" 2>/dev/null)}")
  for line in "\${raw[@]}"; do
    value="\${line%%$'\\t'*}"
    if [[ "$line" == *$'\\t'* ]]; then
      description="\${line#*$'\\t'}"
      completions+=("\${value}:\${description}")
    else
      completions+=("\${value}")
    fi
  done
  _describe 'fdev' completions
}
compdef _fdev fdev
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

function expectsOptionValue(words: string[]): boolean {
  const previous = words.at(-1);
  return Boolean(previous && OPTIONS_WITH_VALUES.has(previous));
}

function resolveProjectDir(words: string[], cwd: string): string {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "-C" || word === "--project") {
      const value = words[index + 1];
      if (value) return resolve(cwd, value);
    }
    if (word.startsWith("--project=")) {
      return resolve(cwd, word.slice("--project=".length));
    }
    if (word === "--config") {
      const value = words[index + 1];
      if (value) return dirname(resolve(cwd, value));
    }
    if (word.startsWith("--config=")) {
      return dirname(resolve(cwd, word.slice("--config=".length)));
    }
  }

  return cwd;
}

function workspaceTargets(projectDir: string, current: string, includeVmIds: boolean): CompletionItem[] {
  const workspaces = readWorkspaces(projectDir);
  const items = workspaces.map((workspace) => ({
    value: workspace.name,
    description: workspace.resourceId,
  }));

  if (includeVmIds && current.length > 0) {
    for (const workspace of workspaces) {
      items.push({
        value: workspace.resourceId,
        description: workspace.name,
      });
    }
  }

  return dedupeItems(items);
}

function readWorkspaces(projectDir: string): Array<{ name: string; resourceId: string }> {
  const statePath = join(projectDir, ".fdev", "state.sqlite");
  if (!existsSync(statePath)) return [];

  const db = new Database(statePath, { readonly: true, create: false });
  try {
    try {
      return db.query<{ name: string; resourceId: string }, []>(
        "SELECT name, resource_id AS resourceId FROM workspaces ORDER BY name",
      ).all();
    } catch {
      return db.query<{ name: string; resourceId: string }, []>(
        "SELECT name, vm_id AS resourceId FROM workspaces ORDER BY name",
      ).all();
    }
  } catch {
    return [];
  } finally {
    db.close();
  }
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
