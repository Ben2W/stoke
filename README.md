# Freestyle Workflows

`fdev` is a CLI and engine for building forkable development workflows from typed task graphs and provider-owned artifacts.

This repo is a pnpm/turbo workspace:

```text
packages/fdev/          project authoring API and project-local runtime binary
packages/fdev-engine/   authoring API, config loader, workflow engine, provider contracts, state
packages/fdev-runtime-client/ shared daemon lifecycle client
packages/fdev-provider-freestyle/ Freestyle provider implementation
packages/fdev-provider-gcloud/    local Google Cloud CLI auth provider
packages/fdev-vscode/   VS Code host package
packages/fdev-cli/      global `fdev` command
apps/app/               placeholder for the future app
apps/install-worker/    Cloudflare Worker for install and release metadata
examples/smoke/         runnable smoke workflow
examples/gcloud-on-open/ copy local gcloud config files on workspace open
docs/                   design docs
```

## Setup

Create `.env` in the repo root:

```bash
FREESTYLE_API_KEY=fs_live_...
```

Install dependencies:

```bash
pnpm install
```

## Commands

```bash
pnpm typecheck
pnpm test
pnpm release:check
pnpm build:cli-binaries
pnpm smoke:plan
pnpm smoke:apply
pnpm --filter @freestyle-sh/fdev-cli fdev -C ../../examples/smoke run create --name my-workspace
pnpm --filter @freestyle-sh/fdev-cli fdev -C ../../examples/smoke projects
pnpm --filter @freestyle-sh/fdev-cli fdev -C ../../examples/smoke run ssh my-workspace --print
```

The CLI also has built-in help:

```bash
pnpm --filter @freestyle-sh/fdev-cli fdev help
pnpm --filter @freestyle-sh/fdev-cli fdev help run
```

Enable shell completion:

```bash
eval "$(fdev completion zsh)"
# or: eval "$(fdev completion bash)"
# or: fdev completion fish | source
```

The installer adds the completion hook for new installs.
Completion includes dynamic runtime operation and workspace targets, so `fdev run ssh <tab>` suggests locally known workspaces from the runtime API.

Initialize a new fdev project:

```bash
fdev init
```

`fdev init` asks for a project name, Freestyle API key, and whether to install dependencies with npm, bun, pnpm, or skip. It then creates a project folder with `fdev.config.ts`, `.env`, `.env.example`, `package.json`, and `.gitignore` entries. For non-interactive setup:

```bash
fdev init --name platform --api-key fs_live_... --package-manager pnpm
```

That creates `./platform`. Use `-C <dir>` with `init` to choose a parent directory for the new project.

By default other `fdev` commands load `fdev.config.ts` from the current directory. Use `-C <dir>` to point at another project directory, or `--config <file>` to load an exact config file.

Remote GitHub project targets can be run without cloning first:

```bash
fdev run plan github:owner/repo
fdev run apply github:owner/repo#branch-name
```

The CLI materializes the repo into `~/.fdev/projects`, installs dependencies if the project runtime is missing, stores state beside the cache, and asks for explicit trust before executing remote project code.

## Current Scope

Implemented:

- `workflow(name, { providers })` with typed `sequence`, `parallel`, `add`, and `task` builders
- task handlers with typed `ctx` plus flattened workflow provider runtimes
- `workspace.onCreated` and uncached `workspace.onOpen` lifecycle hooks
- `DevMachineEngine` with `load`, `plan`, `apply`, `fork`, `attachTerminal`, `listWorkspaces`, and `deleteWorkspace`
- graph-based node-run caching keyed by upstream run IDs and provider fingerprints
- Freestyle provider package for VM create, snapshot refs, create-from-snapshot, provider-owned terminal sessions, workspace fork, exec, and SSH command generation
- Google Cloud provider package for copying local `gcloud` config/auth files, token brokering, and injection helpers
- local `.fdev/state.sqlite` node-run/workspace cache
- manifest-driven `fdev run <operation>` CLI host for runtime-exposed project operations
- project-local runtime daemon with handle/token/lock lifecycle through `@freestyle-sh/fdev-runtime-client`
- VS Code host package using the shared runtime manager
- pnpm/turbo workspace with project package, engine, hosts, app placeholder, and smoke example

The app is intentionally not implemented yet. It should later wrap the same `DevMachineEngine`.

## CLI Releases

The global `fdev` command is distributed as Bun-compiled binaries through GitHub Releases.

See [docs/release.md](docs/release.md) for the release model.

Release tags use the package version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds:

- `fdev-darwin-arm64.tar.gz`
- `fdev-darwin-x64.tar.gz`
- `fdev-linux-arm64.tar.gz`
- `fdev-linux-x64.tar.gz`
- `checksums.txt`

The install Worker serves `curl -fsSL https://fdev.freestyle.sh/install | sh`. It reads GitHub Releases as the source of truth, redirects downloads to the release assets, installs to `~/.fdev/bin/fdev`, and adds that directory to the detected shell profile.
