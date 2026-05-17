# RigKit

`rig` is a CLI and engine for building forkable development workflows from typed task graphs and provider-owned artifacts.

This repo is a pnpm/turbo workspace:

```text
packages/sdk/          project authoring API and project-local runtime binary
packages/engine/   authoring API, config loader, workflow engine, provider contracts, state
packages/runtime-client/ shared daemon lifecycle client
packages/provider-freestyle/ Freestyle provider implementation
packages/fragments/ reusable workflow fragments for configs
packages/provider-gcloud-cli/    local Google Cloud CLI auth provider
packages/provider-vscode/   VS Code host package
packages/cli/      global `rig` command
apps/app/               placeholder for the future app
apps/website/           Astro marketing site + install Worker (rigkit.freestyle.sh)
apps/docs/              Mintlify docs site (docs.rigkit.freestyle.sh)
examples/smoke/         runnable smoke workflow
examples/gcloud-on-open/ copy local gcloud config files with a workspace operation
examples/base-freestyle-fragment/ consume a reusable Freestyle company base fragment
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

### Local example CLI

The `examples/` directory has a shared `.envrc` that puts an example-aware `rig`
shim first on `PATH`. With direnv enabled, plain `rig ...` inside an example
delegates to that example's `node_modules/.bin/rig` instead of a globally
installed `~/.rigkit/bin/rig`.

Install direnv and enable the shell hook once:

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
exec zsh
```

Then allow the examples directory once:

```bash
cd examples
direnv allow
cd global-fragments
which rig
rig --version
```

`which rig` should point at `examples/bin/rig`. If your shell still reports a
global install after `direnv allow`, run `rehash` and check again.
If you do not use direnv, use the manual fallback:

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
rehash
```

## Commands

```bash
pnpm typecheck
pnpm test
pnpm release:check
pnpm build:cli-binaries

cd examples/smoke
rig plan
rig apply
rig create my-workspace
rig projects
rig run my-workspace ssh --print
rig rm my-workspace
```

The CLI also has built-in help:

```bash
rig help
rig run --help
```

Shell completion lets your shell suggest `rig` commands, options, workspace
names, and workspace operations when you press tab. If you installed `rig` with
the official installer, you can usually skip this step: the installer adds the
completion hook to your shell profile for future terminal sessions.

For local development, or to enable completion in the current terminal session
without restarting your shell, run the command for your shell:

```bash
eval "$(rig completion zsh)"
# or: eval "$(rig completion bash)"
# or: rig completion fish | source
```

To test dynamic completion from this checkout, run it inside an example project:

```bash
cd examples/smoke
rig run <tab>
```

In a Rigkit project, `rig run <tab>` suggests locally known workspaces, and
`rig run <workspace> <tab>` suggests operations exposed by that workspace.

Initialize a new Rigkit project:

```bash
rig init
```

`rig init` asks for a project name and whether to install dependencies with npm, bun, pnpm, or skip. It then creates a project folder with `rig.config.ts`, `package.json`, and `.gitignore` entries. For non-interactive setup:

```bash
rig init --name platform --package-manager pnpm
```

That creates `./platform`. Use `-chdir=DIR` with `init` to choose a parent
directory for the new project.

By default other `rig` commands load `rig.config.ts` from the current directory
or nearest parent project. Use Terraform-style global context options before the
command to run against another project or config:

```bash
rig -chdir=examples/smoke plan
rig -chdir=examples/global-fragments -config=api.rig.config.ts apply
```

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
- manifest-driven CLI host for project operations and `rig run <workspace> <operation>` workspace operations
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
