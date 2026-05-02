# Freestyle Dev Machines

`fdev` is a CLI and engine for building forkable Freestyle dev machines from ordered migrations.

This repo is a pnpm/turbo workspace:

```text
packages/fdev-sdk/      SDK authoring API and public config types
packages/fdev-engine/   config loader, migration engine, state, Freestyle provider
packages/fdev-cli/      global `fdev` command
apps/app/               placeholder for the future app
examples/smoke/         runnable smoke dev machine
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
pnpm --filter @freestyle-sh/fdev-cli fdev -C ../../examples/smoke fork --name my-workspace
pnpm --filter @freestyle-sh/fdev-cli fdev -C ../../examples/smoke ls
pnpm --filter @freestyle-sh/fdev-cli fdev -C ../../examples/smoke ssh my-workspace --print
```

The CLI also has built-in help:

```bash
pnpm --filter @freestyle-sh/fdev-cli fdev help
pnpm --filter @freestyle-sh/fdev-cli fdev help fork
```

Initialize a new fdev project:

```bash
fdev init
```

`fdev init` asks for a project name, Freestyle API key, and whether to install dependencies with npm, bun, pnpm, or skip. It then creates `fdev.config.ts`, `.env`, `.env.example`, `package.json`, and `.gitignore` entries. For non-interactive setup:

```bash
fdev init --name platform --api-key fs_live_... --package-manager pnpm
```

By default `fdev` loads `fdev.config.ts` from the current directory. Use `-C <dir>` to point at another project directory, or `--config <file>` to load an exact config file.

## Current Scope

Implemented:

- `defineDevMachine({ name, apiKey, image, migrations })`
- `defineMigration(name, fn)` with typed inputs
- `DevMachineEngine` with `load`, `plan`, `apply`, `fork`, `attachTerminal`, `listWorkspaces`, and `deleteWorkspace`
- Freestyle provider for VM create, snapshot, create-from-snapshot, exec, and SSH command generation
- local `.fdev/state.json` snapshot/workspace cache
- Commander-based `fdev` CLI for `init`, `plan`, `apply`, `fork`, `ls`, `ssh`, `snapshot`, and `rm`
- pnpm/turbo workspace with separate SDK, engine, CLI packages, app placeholder, and smoke example

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

The installer script in `scripts/install-fdev.sh` downloads from `github.com/freestyle-sh/fdev` by default, installs to `~/.fdev/bin/fdev`, and adds that directory to the detected shell profile.
