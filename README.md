# Freestyle Dev Machines

`fdev` is a Bun-based CLI and engine for building forkable Freestyle dev machines from ordered migrations.

## Setup

Create `.env` in the repo root:

```bash
FREESTYLE_API_KEY=fs_live_...
```

Install dependencies:

```bash
bun install
```

## Commands

```bash
bun src/cli.ts machines
bun src/cli.ts plan freestyle-platform
bun src/cli.ts apply freestyle-platform
bun src/cli.ts fork freestyle-platform --name my-workspace
bun src/cli.ts terminal my-workspace --print
```

The package also exposes a `fdev` bin when installed or linked.

## Current Scope

Implemented:

- `defineDevMachine({ name, apiKey, image, migrations })`
- `defineMigration(name, fn)` with typed inputs
- `DevMachineEngine` with `load`, `plan`, `apply`, `fork`, `attachTerminal`
- Freestyle provider for VM create, snapshot, create-from-snapshot, exec, and SSH command generation
- local `.fdev/state.json` snapshot/workspace cache
- `fdev` CLI for `machines`, `plan`, `apply`, `fork`, `terminal`, and `snapshot`

The app is intentionally not implemented yet. It should later wrap the same `DevMachineEngine`.
