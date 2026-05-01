# Declarative Dev Machines SDK Design

## Summary

The SDK should model a remote dev machine as an ordered chain of state migrations over a base VM image.

Freestyle already provides the important low-level primitive: microVMs with filesystem snapshots, memory snapshots, and forks. The SDK should expose a higher-level workflow:

```text
image + resources
  -> migration 1
  -> snapshot
  -> migration 2
  -> snapshot
  -> migration N
  -> current dev machine snapshot
  -> workspace forks for humans and agents
```

There should not be a separate VM spec layer for packages and CLIs. Installing Node, installing `gcloud`, cloning repos, logging into services, installing dotfiles, and validating VPN state are all migrations over machine state.

The top-level API should stay small:

```ts
defineDevMachine({ name, apiKey, image, migrations })
defineMigration(name, fn)
defineMigration<Input>(name, fn)(input)
```

Auth should not have a special happy-path abstraction. It should be written using the same raw primitives as every other migration: inspect the VM, run checks, open an interactive terminal or browser when needed, verify the final state, then snapshot.

Reusable migrations should be parameterizable. Team migrations should not have to hardcode a user's email, GitHub handle, repo list, or cloud project. `defineDevMachine` should accept typed options and use them to instantiate migrations with typed inputs.

For v1, `defineDevMachine` should require a Freestyle API key. That key is for the SDK to call the Freestyle API: create VMs, fork from snapshots, run commands, expose terminals, and create new snapshots. It is not remote VM auth state and should not be injected into the VM unless a migration explicitly does so.

## Problem

Local dev machines are valuable because they accumulate state:

- runtimes and CLIs are installed
- repos are cloned
- Git, cloud, agent, package registry, and VPN auth work
- dotfiles and shell preferences are present
- caches and browser profiles are warm

Remote agent swarms break this assumption. Creating many remote machines is easy only if each machine does not need personal state. Real coding agents usually need the same state a human developer's laptop has.

Classic infrastructure-as-code does not fit well because much of this state is not purely declarative. A script may need to ask:

- is this repo already cloned?
- is `gcloud` installed?
- can I get an access token?
- is the VPN connected?
- does this CLI need a human login?
- should I open a browser or SSH session so the user can fix the machine?

The SDK should embrace this. A dev machine definition is not only a static declaration. It is an ordered, resumable migration program with snapshots between successful state transitions.

## Goals

- Provide a TypeScript SDK for defining remote dev machines.
- Make migrations the main unit of composition, caching, and replay.
- Let teams publish shared migrations and users append personal migrations.
- Let migrations inspect current VM state and decide whether to run.
- Support interactive repair and auth flows through raw terminal/browser primitives.
- Snapshot after successful migrations so later changes do not replay the whole chain.
- Let workspaces fork cheaply from the resolved dev machine snapshot.
- Keep the SDK usable from scripts, the `fdev` CLI, and a cmux-like app.

## Non-Goals

- Do not create a custom DSL in v1.
- Do not make auth a separate declarative subsystem.
- Do not require users to express every check as a built-in policy like "freshness."
- Do not expose Freestyle's raw VM API as the main product surface.
- Do not make long-lived mutable VMs the core abstraction.

## Core Concepts

### Dev Machine

A dev machine is a named chain of migrations over an image:

```ts
export default defineDevMachine({
  name: "freestyle-platform",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",
  cpu: 4,
  memory: "8GiB",
  disk: "80GiB",

  migrations: [
    systemPackages,
    node22,
    gcloudCli,
    freestyleRepo,
    gcloudAuth({ email: "ben@freestyle.sh" }),
    claudeAuth,
    codexAuth,
  ],
});
```

For v1, a config file exports exactly one dev machine. Multiple machines should be represented as multiple config files or directories, selected with `-C <dir>` or `--config <file>`.

The `apiKey` authenticates the SDK against the Freestyle API. The `image`, CPU, memory, and disk settings describe the root machine substrate. Everything that mutates the filesystem, shell, repos, tools, auth, or config should be a migration.

### Migration

A migration is a named, idempotent state transition:

```ts
export const node22 = defineMigration("runtime:node-22", async ({
  vm,
  step,
}) => {
  const installed = await vm.exec("node --version").catch(() => null);
  if (installed?.stdout.trim().startsWith("v22.")) return;

  await step.run("install node 22", `
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    corepack enable
  `);

  await step.assert("verify node 22", async ({ vm }) => {
    const result = await vm.exec("node --version");
    return result.stdout.trim().startsWith("v22.");
  });
});
```

A migration can:

- inspect the current VM
- skip itself if the desired state already exists
- run one or more named durable steps
- ask the user to complete an interactive flow
- verify postconditions
- emit logs and metadata
- produce a snapshot after success

Migration names should be stable and human-readable. They are part of the cache and lineage model.

### Snapshot Chain

The SDK should snapshot after each successful migration. Each snapshot records:

- dev machine name
- image and resource settings
- migration prefix
- migration versions or content hashes
- owner or team scope
- previous snapshot id
- output metadata from the migration

When applying a dev machine, the SDK should find the latest valid snapshot for the migration prefix and run only the missing suffix.

### Workspace

A workspace is a fork from a resolved dev machine snapshot. Workspaces are where humans and agents actually work.

Workspaces are disposable by default. Code changes should leave through Git commits, patches, PRs, explicit workspace snapshots, or explicit promotion.

## SDK Shape

### Freestyle API Key

`defineDevMachine` should require a Freestyle API key in v1:

```ts
export default defineDevMachine({
  name: "freestyle-platform",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",
  migrations: [...teamMigrations],
});
```

This key is used by the local SDK, CLI, and app to call the Freestyle API. It authorizes control-plane operations such as creating VMs, forking snapshots, executing commands, attaching terminals, exposing browser sessions, and writing snapshots.

The API key should usually come from `.env`:

```bash
FREESTYLE_API_KEY=fs_live_...
FDEV_EMAIL=ben@freestyle.sh
FDEV_GCLOUD_PROJECT=freestyle-prod
```

The key should not automatically become part of the remote machine. If a user wants a credential inside the VM, they should write an explicit migration for that state. Later, this field can accept an OAuth-backed provider:

```ts
apiKey: async () => freestyleOAuth.getToken()
```

The important contract is that `apiKey` authenticates the SDK with Freestyle; migrations handle machine state.

### Full Example

```ts
// fdev.config.ts
import {
  defineDevMachine,
  defineMigration,
  env,
} from "@freestyle/fdev";

const systemPackages = defineMigration("system:packages", async ({ vm, step }) => {
  const git = await vm.exec("command -v git").catch(() => null);
  const rg = await vm.exec("command -v rg").catch(() => null);
  const zsh = await vm.exec("command -v zsh").catch(() => null);
  if (git?.ok && rg?.ok && zsh?.ok) return;

  await step.run("install system packages", `
    apt-get update
    apt-get install -y git curl ripgrep zsh
  `);

  await step.assert("verify packages", async ({ vm }) => {
    const git = await vm.exec("command -v git").catch(() => null);
    const rg = await vm.exec("command -v rg").catch(() => null);
    return Boolean(git?.ok && rg?.ok);
  });
});

const node22 = defineMigration("runtime:node-22", async ({ vm, step }) => {
  const installed = await vm.exec("node --version").catch(() => null);
  if (installed?.stdout.trim().startsWith("v22.")) return;

  await step.run("install node 22", `
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    corepack enable
  `);

  await step.assert("verify node", async ({ vm }) => {
    const result = await vm.exec("node --version");
    return result.stdout.trim().startsWith("v22.");
  });
});

const gcloudCli = defineMigration("cli:gcloud", async ({ vm, step }) => {
  const installed = await vm.exec("gcloud --version").catch(() => null);
  if (installed?.ok) return;

  await step.run("install gcloud cli", `
    curl https://sdk.cloud.google.com | bash
  `);

  await step.assert("verify gcloud cli", async ({ vm }) => {
    const result = await vm.exec("gcloud --version").catch(() => null);
    return Boolean(result?.ok);
  });
});

const freestyleRepo = defineMigration("repo:freestyle", async ({ vm, step }) => {
  if (await vm.exists("~/src/freestyle/.git")) {
    await step.run("fetch freestyle repo", `
      cd ~/src/freestyle
      git fetch origin
    `);
    return;
  }

  await step.run("clone freestyle repo", `
    mkdir -p ~/src
    git clone git@github.com:freestyle-sh/freestyle.git ~/src/freestyle
  `);

  await step.assert("verify freestyle repo", async ({ vm }) => {
    return vm.exists("~/src/freestyle/.git");
  });
});

type GcloudAuthInput = {
  email?: string;
  project?: string;
};

const gcloudAuth = defineMigration<GcloudAuthInput>("auth:gcloud", async ({
  input,
  vm,
  step,
  interact,
}) => {
  const token = await vm.exec("gcloud auth print-access-token").catch(() => null);
  const account = await vm.exec(
    "gcloud auth list --filter=status:ACTIVE --format='value(account)'",
  ).catch(() => null);
  const project = await vm.exec("gcloud config get-value project").catch(() => null);

  if (
    token?.ok &&
    (!input.email || account?.stdout.trim() === input.email) &&
    (!input.project || project?.stdout.trim() === input.project)
  ) {
    return;
  }

  await interact.terminal("gcloud login", {
    command: "gcloud auth login --update-adc",
    instructions: "Complete the Google login flow for the account this machine should use.",
  });

  await step.assert("verify gcloud auth", async ({ vm }) => {
    const result = await vm.exec("gcloud auth print-access-token").catch(() => null);
    return Boolean(result?.ok);
  });

  if (input.project) {
    await step.run("set gcloud project", "gcloud config set project \"$GCLOUD_PROJECT\"", {
      env: { GCLOUD_PROJECT: input.project },
    });
  }

  await step.run("record gcloud account", `
    mkdir -p ~/.freestyle
    gcloud auth list --filter=status:ACTIVE --format='value(account)' \
      > ~/.freestyle/gcloud-account
  `);

  await step.assert("verify expected gcloud account", async ({ vm }) => {
    if (!input.email) return true;

    const result = await vm.exec(
      "gcloud auth list --filter=status:ACTIVE --format='value(account)'",
    );

    return result.stdout.trim() === input.email;
  });

  await step.assert("verify expected gcloud project", async ({ vm }) => {
    if (!input.project) return true;

    const result = await vm.exec("gcloud config get-value project");
    return result.stdout.trim() === input.project;
  });
});

const claudeAuth = defineMigration("auth:claude", async ({
  vm,
  step,
  interact,
}) => {
  const user = await vm.exec("claude whoami").catch(() => null);
  if (user?.ok) return;

  await interact.terminal("claude login", {
    command: "claude auth login",
  });

  await step.assert("verify claude auth", async ({ vm }) => {
    const result = await vm.exec("claude whoami").catch(() => null);
    return Boolean(result?.ok);
  });
});

const codexAuth = defineMigration("auth:codex", async ({
  vm,
  step,
  interact,
}) => {
  const status = await vm.exec("codex auth status").catch(() => null);
  if (status?.ok) return;

  await interact.terminal("codex login", {
    command: "codex login",
  });

  await step.assert("verify codex auth", async ({ vm }) => {
    const result = await vm.exec("codex auth status").catch(() => null);
    return Boolean(result?.ok);
  });
});

export default defineDevMachine({
  name: "freestyle-platform",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",
  cpu: 4,
  memory: "8GiB",
  disk: "80GiB",

  migrations: [
    systemPackages,
    node22,
    gcloudCli,
    freestyleRepo,
    gcloudAuth({ email: "ben@freestyle.sh" }),
    claudeAuth,
    codexAuth,
  ],
});
```

### Team And User Composition

Teams should be able to publish shared migration arrays. Users should be able to append private migrations without copying the team setup.

```ts
// @freestyle/team-dev-machine
export const teamMigrations = [
  systemPackages,
  node22,
  gcloudCli,
  freestyleRepo,
  teamVpn,
];
```

```ts
// fdev.config.ts
import { teamMigrations } from "@freestyle/team-dev-machine";

const benDotfiles = defineMigration("user:ben-dotfiles", async ({ vm, step }) => {
  if (await vm.exists("~/.dotfiles")) return;

  await step.run("install dotfiles", `
    git clone git@github.com:ben/dotfiles.git ~/.dotfiles
    ~/.dotfiles/install.sh
  `);
});

export default defineDevMachine({
  name: "ben-freestyle",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",
  migrations: [
    ...teamMigrations,
    claudeAuth,
    codexAuth,
    benDotfiles,
  ],
});
```

The app can show this as a chain: shared team state first, user-specific state after.

### Parameterized Migrations

Migrations should support typed inputs so shared migrations can be reused across users and teams.

Parameterized migrations are useful for values like expected email, GitHub username, cloud project, repo names, or customer environment.

```ts
type GithubAuthOptions = {
  email: string;
};

export const githubAuth = defineMigration<GithubAuthOptions>("auth:github", async ({
  input,
  vm,
  step,
  interact,
}) => {
  const current = await vm.exec("gh api user --jq .email").catch(() => null);
  if (current?.stdout.trim() === input.email) return;

  await interact.terminal("github login", {
    command: "gh auth login",
    instructions: `Log into GitHub as ${input.email}.`,
  });

  await step.assert("verify github email", async ({ vm }) => {
    const result = await vm.exec("gh api user --jq .email");
    return result.stdout.trim() === input.email;
  });
});
```

Then `defineDevMachine` passes concrete values:

```ts
export default defineDevMachine({
  name: "ben-freestyle",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",

  migrations: [
    ...teamMigrations,
    githubAuth({ email: "ben@freestyle.sh" }),
    gcloudAuth({ email: "ben@freestyle.sh", project: "freestyle-prod" }),
  ],
});
```

For larger setups, `defineDevMachine` can accept a typed `options` object and use it to construct migrations:

```ts
type FreestyleMachineOptions = {
  email: string;
  githubUser: string;
  gcloudProject: string;
  repos: string[];
};

export default defineDevMachine<FreestyleMachineOptions>({
  name: "freestyle-platform",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",

  options: {
    email: env("FDEV_EMAIL"),
    githubUser: "ben",
    gcloudProject: env("FDEV_GCLOUD_PROJECT"),
    repos: ["freestyle", "cmux"],
  },

  migrations: ({ options }) => [
    ...teamMigrations,
    githubAuth({ email: options.email }),
    gcloudAuth({ email: options.email, project: options.gcloudProject }),
    repos(options.repos),
    userDotfiles({ githubUser: options.githubUser }),
  ],
});
```

The migration chain should include the migration name and the serialized input used to instantiate it. Changing `githubAuth({ email })` from one email to another should invalidate that migration and any later snapshots.

## Migration Context

Each migration receives a context with low-level but structured primitives.

```ts
type MigrationContext<Input = void> = {
  input: Input;
  vm: VmInspector;
  step: StepRunner;
  interact: InteractionRunner;
  snapshot: SnapshotController;
};
```

### VM Inspector

`vm` is for reading and probing current machine state.

```ts
await vm.exists("~/src/freestyle/.git");
await vm.exec("git status --short", { cwd: "~/src/freestyle" });
await vm.readFile("~/.freestyle/gcloud-account");
```

`vm.exec` returns stdout, stderr, exit code, and an `ok` boolean.

### Step Runner

`step` is for durable named actions that mutate or validate the machine.

```ts
await step.run("install pnpm deps", "pnpm install", {
  cwd: "~/src/freestyle",
});

await step.assert("node is v22", async ({ vm }) => {
  const result = await vm.exec("node --version");
  return result.stdout.trim().startsWith("v22.");
});

await step.assert("tests pass", async ({ vm }) => {
  const result = await vm.exec("pnpm test", { cwd: "~/src/freestyle" });
  return result.ok;
});
```

`step.assert` is the validation primitive. It accepts a boolean predicate so assertions can inspect stdout, parse JSON, check files, or decide based on multiple commands. Command exit-code checks should still go through `assert`:

```ts
await step.assert("shell test suite passes", async ({ vm }) => {
  const result = await vm.exec("pnpm test", { cwd: "~/src/freestyle" });
  return result.ok;
});
```

Step names are visible in CLI logs and app timelines.

### Interaction Runner

`interact` is for human-in-the-loop flows.

```ts
await interact.terminal("gcloud login", {
  command: "gcloud auth login --update-adc",
  instructions: "Complete the browser/device login flow.",
});

await interact.browser("internal SSO", {
  url: "http://localhost:8080/login",
  instructions: "Complete SSO, then return to continue.",
});

await interact.manual("hardware approval", {
  instructions: "Approve the VPN login on your device.",
});
```

The SDK should not need to know whether this is auth, VPN, SSO, or a local helper. It only needs to provide ways to pause execution, attach the user, and continue after checks pass.

### Snapshot Controller

Snapshots should be automatic after successful migrations, but advanced migrations may need explicit controls:

```ts
await snapshot.before("remove browser cache", `
  rm -rf ~/.cache/google-chrome/Default/Cache
`);

await snapshot.metadata({
  gcloudAccount: await vm.readFile("~/.freestyle/gcloud-account"),
});
```

The default should be simple: if the migration completes, the SDK snapshots the VM and records the migration as applied.

## Caching And Replay

The cache is the snapshot chain.

When resolving a dev machine:

```text
1. Load the dev machine definition.
2. Compute the ordered migration chain.
3. Find the newest snapshot matching the longest valid prefix.
4. Fork or resume from that snapshot.
5. Run the remaining migrations in order.
6. Snapshot after each successful migration.
7. Return the final snapshot as the current dev machine state.
```

Because migrations can inspect state, each migration should be idempotent. A migration may decide no work is needed and return. The SDK can still record that the migration was satisfied for this chain.

Changing, removing, or reordering a migration changes the chain after that point. Appending a migration should usually only run the appended migration.

## Auth Model

Auth is just a migration.

This is intentionally raw. The SDK should not require users to encode auth in a predesigned freshness model. A migration can express whatever readiness means:

```ts
const vpn = defineMigration("auth:vpn", async ({ vm, step, interact }) => {
  const status = await vm.exec("company-vpn status --json").catch(() => null);
  if (status?.ok && JSON.parse(status.stdout).connected) return;

  await interact.terminal("vpn login", {
    command: "company-vpn login",
    instructions: "Complete VPN login for the workspace.",
  });

  await step.assert("verify vpn", async ({ vm }) => {
    const status = await vm.exec("company-vpn status --json").catch(() => null);
    return Boolean(status?.ok && JSON.parse(status.stdout).connected);
  });
});
```

A user who cares about token TTL can write that logic directly:

```ts
const gcloudReady = defineMigration("auth:gcloud-ready", async ({
  vm,
  step,
  interact,
}) => {
  const status = await vm.exec("node ./scripts/check-gcloud.js");

  if (status.exitCode === 0) return;

  await interact.terminal("repair gcloud", {
    command: "gcloud auth login --update-adc",
  });

  await step.assert("verify gcloud", async ({ vm }) => {
    const result = await vm.exec("node ./scripts/check-gcloud.js");
    return result.ok;
  });
});
```

The SDK provides control flow and VM access. The user owns the definition of "ready."

## Workspaces And Agents

The dev machine chain produces a current snapshot. Workspaces fork from that snapshot.

```bash
fdev apply
fdev fork --name fix-billing-bug
fdev ssh fix-billing-bug
fdev run fix-billing-bug --agent codex
```

Workspace configuration can be added later as another top-level field:

```ts
export default defineDevMachine({
  name: "freestyle-platform",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",
  migrations: [
    ...teamMigrations,
    gcloudAuth({ email: "ben@freestyle.sh" }),
    codexAuth,
  ],

  workspace: {
    cwd: "~/src/freestyle",
    terminals: ["zsh"],
    agents: {
      codex: "codex",
      claude: "claude",
    },
    ports: [3000],
  },
});
```

The workspace field should not mutate machine state. It describes how humans and agents attach to forks.

## Project Workflow

Most users should maintain dev machine definitions in a dedicated repo, similar to a Terraform repo:

```text
freestyle-dev-machines/
  package.json
  fdev.config.ts
  .env
  .env.example
  migrations/
    system.ts
    repos.ts
    auth.ts
    dotfiles.ts
```

The repo is where teams and users iterate on remote dev state over time. It should be editable, reviewable, and shareable. A team can own shared migrations, and each user can add private migrations in their own config repo or with `--config` pointed at a personal config file.

`package.json` can expose the CLI commands for the repo:

```json
{
  "scripts": {
    "plan": "fdev plan",
    "apply": "fdev apply"
  },
  "dependencies": {
    "@freestyle/fdev": "latest"
  }
}
```

Then a v1 workflow is:

```bash
git clone git@github.com:freestyle-sh/dev-machines.git
cd dev-machines
cp .env.example .env
pnpm install
fdev plan
fdev apply
```

Later, once the app exists, `bun start` can become `fdev app` and open the local cmux-like UI for the same repo.

`.env` should configure local definition-time values and the Freestyle API key:

```bash
FREESTYLE_API_KEY=fs_live_...
FDEV_EMAIL=ben@freestyle.sh
FDEV_GCLOUD_PROJECT=freestyle-prod
```

The API key lets the SDK call Freestyle. It should not be copied into remote machines by default. Other `.env` values can be passed into typed machine options and migration inputs.

## Engine

There should be a shared execution layer between the SDK definitions and every user interface. The CLI should not contain the migration execution logic, and the app should not shell out to CLI commands.

The architecture should be:

```text
fdev.config.ts
  -> SDK loader and planner
  -> DevMachineEngine
  -> Freestyle provider
  -> Freestyle API
```

Both clients should call the same engine:

```text
fdev CLI ----\
              -> DevMachineEngine -> Freestyle provider
fdev app ----/
```

The engine owns:

- loading `fdev.config.ts`
- loading `.env` and resolving `env(...)`
- validating `defineDevMachine` definitions
- constructing the Freestyle provider from `apiKey`
- computing migration chain keys
- finding the longest valid snapshot prefix
- creating and forking VMs
- executing migrations
- exposing `vm`, `step`, `interact`, and `snapshot` contexts
- snapshotting after successful migrations
- creating workspace forks
- attaching terminals
- emitting structured events

The CLI should use Commander for argument parsing and help text. It should call the engine, render events, and set exit codes. It should not duplicate planner or runner logic.

The app should come later as another client of the same engine. In practice, `fdev app` can start a local web server plus an engine process. The browser UI talks to localhost, and that local process reads `.env`, loads `fdev.config.ts`, and calls Freestyle with `FREESTYLE_API_KEY`.

Initial engine API shape:

```ts
const engine = await createDevMachineEngine({
  projectDir: process.cwd(),
});

engine.onEvent((event) => {
  // CLI prints this; app renders it.
});

await engine.load();

const plan = await engine.plan({
});

await engine.apply({
});

const workspace = await engine.fork({
  name: "fix-billing-bug",
});

await engine.attachTerminal({
  workspaceOrVmId: workspace.name,
});
```

This engine is the first implementation target, alongside the `fdev` CLI.

## CLI

The `fdev` CLI should be the first consumer of the SDK.

```bash
fdev plan
fdev apply
fdev fork --name fix-auth-bug
fdev ls
fdev ssh fix-auth-bug
fdev snapshot fix-auth-bug --label experiments/fix-auth-bug
fdev rm fix-auth-bug --yes
fdev gc
```

Suggested command responsibilities:

- `plan`: load TypeScript, validate the migration chain, and print the graph
- `apply`: resolve the dev machine by running missing migrations
- `fork`: create a workspace VM from the resolved dev machine snapshot
- `ls`: list workspace forks, snapshots, or config metadata
- `ssh`: attach to a workspace or VM
- `snapshot`: capture a workspace
- `rm`: delete a workspace VM and remove it from local state
- `gc`: clean stale local cache entries for old machine chains

The CLI should use `fdev.config.ts` in the current directory by default. `-C <dir>` selects another project directory and loads `<dir>/fdev.config.ts`. `--config <file>` loads an exact file. `--json` prints machine-readable output for automation.

## App Integration

The app should be a later client for the same engine, migration chain, and workspace model. It should be launched with `fdev app` or `bun start` from a dev machine repo after the engine and CLI are working.

The engine should emit structured data for:

- dev machine definitions
- migration chain
- current snapshot
- snapshot lineage
- migration status
- interactive waits
- workspace status
- agent run status
- terminal and browser attach URLs
- logs and lifecycle events

The app can then provide:

- dev machine gallery
- `.env` readiness checks, including whether `FREESTYLE_API_KEY` is present
- migration timeline
- "apply missing migrations" action
- "repair this migration" action
- create N workspace forks
- terminal tabs per workspace
- browser tabs per workspace
- agent run views
- diff/PR/status views
- snapshot promotion and cleanup controls

## Event Model

Both CLI and app need structured events.

```ts
type DevMachineEvent =
  | { type: "definition.loaded"; machine: string }
  | { type: "migration.skipped"; migration: string; snapshotId: string }
  | { type: "migration.started"; migration: string }
  | { type: "step.started"; migration: string; step: string; command?: string }
  | { type: "step.output"; migration: string; step: string; stream: "stdout" | "stderr"; data: string }
  | { type: "step.completed"; migration: string; step: string; exitCode: number }
  | { type: "interaction.awaiting_user"; migration: string; label: string; attachUrl?: string }
  | { type: "interaction.completed"; migration: string; label: string }
  | { type: "snapshot.created"; migration: string; snapshotId: string }
  | { type: "workspace.ready"; workspaceId: string; snapshotId: string }
  | { type: "agent.started"; runId: string; workspaceId: string; agent: string }
  | { type: "agent.completed"; runId: string; exitCode: number };
```

This avoids separate execution paths for the CLI and the app.

## Provider Interface

The user-facing SDK should not be a thin wrapper over Freestyle APIs, but it should isolate Freestyle behind a provider interface.

```ts
export function createFreestyleProvider(input: {
  apiKey: string;
}): DevMachineProvider;

export interface DevMachineProvider {
  createVm(input: CreateVmInput): Promise<VmHandle>;
  forkVm(input: ForkVmInput): Promise<VmHandle>;
  exec(vm: VmHandle, command: ExecCommand): Promise<ExecResult>;
  openTerminal(vm: VmHandle, options?: TerminalOptions): Promise<TerminalSession>;
  openBrowser(vm: VmHandle, options?: BrowserOptions): Promise<BrowserSession>;
  exposePort(vm: VmHandle, port: number): Promise<PortHandle>;
  snapshot(vm: VmHandle, options: SnapshotOptions): Promise<SnapshotHandle>;
  deleteVm(vm: VmHandle): Promise<void>;
}
```

The top-level SDK should expose dev machine concepts. Provider-specific Freestyle details should live below that layer. In v1, `defineDevMachine.apiKey` is used to construct the Freestyle-backed provider for that machine.

## First Milestone

Build the engine and CLI first. Do not build the app in the first implementation pass.

1. TypeScript loader for `fdev.config.ts`.
2. Authoring API: `defineDevMachine({ name, apiKey, image, migrations })`.
3. Authoring API: `defineMigration(name, fn)` and typed migration inputs.
4. `DevMachineEngine` with `load`, `plan`, `apply`, `fork`, `attachTerminal`, workspace listing, and workspace deletion.
5. Freestyle provider constructed from `defineDevMachine.apiKey`.
6. Migration context with `vm`, `step`, `interact.terminal`, and `snapshot`.
7. Snapshot after each successful migration.
8. Longest-prefix snapshot reuse.
9. Structured event stream shared by engine and CLI.
10. `fdev plan`.
11. `fdev apply`.
12. `fdev fork`.
13. `fdev ls`.
14. `fdev ssh`.
15. `fdev rm`.

This proves the state model and CLI loop before building the app or multi-agent experience.

## Later Milestones

- `fdev app` local UI backed by the same `DevMachineEngine`.
- Browser interaction support.
- Workspace config for terminals, agents, ports, and cwd.
- Memory snapshot support for warm starts.
- Team migration package registry.
- User-private migration layers.
- Snapshot cleanup and retention policies.
- Policy controls for who can fork which snapshots.
- Agent run abstraction for Codex and Claude Code.
- App UI using the same event stream.

## Product Thesis

The useful abstraction is authenticated, forkable computer state.

The SDK should let users describe how to build and repair that state through ordered migrations, snapshot each successful transition, and fork workspaces from the latest resolved machine for humans and agents.
