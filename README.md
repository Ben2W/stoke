# RigKit

`rig` is a CLI and engine for building forkable development workflows from typed task graphs and provider-owned artifacts.

This repo is a pnpm/turbo workspace:

```text
packages/sdk/          project authoring API and project-local runtime binary
packages/engine/   authoring API, config loader, workflow engine, provider contracts, state
packages/runtime-client/ shared daemon lifecycle client
packages/provider-freestyle/ Freestyle provider implementation
packages/provider-gcloud-cli/    local Google Cloud CLI auth provider
packages/provider-vscode/   VS Code host package
packages/cli/      global `rig` command
apps/app/               placeholder for the future app
apps/install-worker/    Cloudflare Worker for install and release metadata
examples/smoke/         runnable smoke workflow
examples/gcloud-on-open/ copy local gcloud config files with a workspace operation
docs/                   design docs
```

## Setup

Freestyle auth is handled by the provider. By default Rigkit opens the Freestyle browser login and stores provider-owned host credentials outside project state. To use API-key auth, pass `auth: { apiKey: env("FREESTYLE_API_KEY") }` in the provider config.

```bash
# Optional, only used by configs that opt into API-key auth.
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
pnpm --filter @rigkit/cli rigkit -C ../../examples/smoke run create --name my-workspace
pnpm --filter @rigkit/cli rigkit -C ../../examples/smoke projects
pnpm --filter @rigkit/cli rigkit -C ../../examples/smoke run ssh my-workspace --print
```

The CLI also has built-in help:

```bash
pnpm --filter @rigkit/cli rig help
pnpm --filter @rigkit/cli rig help run
```

Enable shell completion:

```bash
eval "$(rig completion zsh)"
# or: eval "$(rig completion bash)"
# or: rig completion fish | source
```

The installer adds the completion hook for new installs.
Completion includes dynamic runtime operation and workspace targets, so `rig ssh <tab>` suggests locally known workspaces from the runtime API.

Initialize a new Rigkit project:

```bash
rig init
```

`rig init` asks for a project name and whether to install dependencies with npm, bun, pnpm, or skip. It then creates a project folder with `rig.config.ts`, `package.json`, and `.gitignore` entries. For non-interactive setup:

```bash
rig init --name platform --package-manager pnpm
```

That creates `./platform`. Use `-C <dir>` with `init` to choose a parent directory for the new project.

By default other `rig` commands load `rig.config.ts` from the current directory. Use `-C <dir>` to point at another project directory, or `--config <file>` to load an exact config file.

Remote GitHub project targets can be run without cloning first:

```bash
rig plan github:owner/repo
rig apply github:owner/repo#branch-name
```

The CLI materializes the repo into `~/.rigkit/projects`, installs dependencies if the project runtime is missing, stores state beside the cache, and asks for explicit trust before executing remote project code.

## Current Scope

Implemented:

- `workflow(name, { providers })` with typed `sequence`, `parallel`, `add`, and `task` builders
- task handlers with typed `ctx` plus flattened workflow provider runtimes
- generic typed workspaces with required `create`/`remove` handlers and workspace operations
- `DevMachineEngine` with `load`, `plan`, `apply`, `fork`, `attachTerminal`, `listWorkspaces`, and `deleteWorkspace`
- graph-based node-run caching keyed by upstream run IDs and provider fingerprints
- Freestyle provider package for VM create, snapshot refs, create-from-snapshot, provider-owned terminal sessions, workspace fork, exec, and SSH command generation
- Google Cloud provider package for copying local `gcloud` config/auth files, token brokering, and injection helpers
- local `.rigkit/state.sqlite` node-run/workspace cache
- manifest-driven `rig <operation>` CLI host for runtime-exposed project operations
- project-local runtime daemon with handle/token/lock lifecycle through `@rigkit/runtime-client`
- VS Code host package using the shared runtime manager
- pnpm/turbo workspace with project package, engine, hosts, app placeholder, and smoke example

The app is intentionally not implemented yet. It should later wrap the same `DevMachineEngine`.

## CLI Releases

The global `rig` command is distributed as Bun-compiled binaries through GitHub Releases.

See [docs/release.md](docs/release.md) for the release model.

Release tags use the package version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds:

- `rig-darwin-arm64.tar.gz`
- `rig-darwin-x64.tar.gz`
- `rig-linux-arm64.tar.gz`
- `rig-linux-x64.tar.gz`
- `checksums.txt`

The install Worker serves `curl -fsSL https://rigkit.freestyle.sh/install | sh`. It reads GitHub Releases as the source of truth, redirects downloads to the release assets, installs to `~/.rigkit/bin/rig`, and adds that directory to the detected shell profile.
