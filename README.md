# Freestyle Dev Machines

`fdev` is a CLI and engine for building forkable Freestyle dev machines from ordered migrations.

This repo is a pnpm/turbo workspace:

```text
packages/fdev/      CLI, SDK authoring API, engine, Freestyle provider
apps/app/           placeholder for the future app
examples/smoke/     runnable smoke dev machine
docs/               design docs
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
pnpm smoke:plan
pnpm smoke:apply
pnpm --filter @freestyle/fdev fdev -C ../../examples/smoke fork --name my-workspace
pnpm --filter @freestyle/fdev fdev -C ../../examples/smoke ls
pnpm --filter @freestyle/fdev fdev -C ../../examples/smoke ssh my-workspace --print
```

The CLI also has built-in help:

```bash
pnpm --filter @freestyle/fdev fdev help
pnpm --filter @freestyle/fdev fdev help fork
```

By default `fdev` loads `fdev.config.ts` from the current directory. Use `-C <dir>` to point at another project directory, or `--config <file>` to load an exact config file.

## Current Scope

Implemented:

- `defineDevMachine({ name, apiKey, image, migrations })`
- `defineMigration(name, fn)` with typed inputs
- `DevMachineEngine` with `load`, `plan`, `apply`, `fork`, `attachTerminal`, `listWorkspaces`, and `deleteWorkspace`
- Freestyle provider for VM create, snapshot, create-from-snapshot, exec, and SSH command generation
- local `.fdev/state.json` snapshot/workspace cache
- Commander-based `fdev` CLI for `init`, `plan`, `apply`, `fork`, `ls`, `ssh`, `snapshot`, `rm`, and `gc`
- pnpm/turbo workspace with separate CLI package, app placeholder, and smoke example

The app is intentionally not implemented yet. It should later wrap the same `DevMachineEngine`.
