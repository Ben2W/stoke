# Rigkit

Declarative dev environments, in TypeScript.

Rigkit lets you describe a development environment in `rigkit/index.ts`, run it
through the `rig` CLI, and create isolated named workspaces from cached
provider-owned artifacts. It is built for agent work, remote development, CI
jobs, and tests where the same environment has to be prepared once and reused
reliably.

- Website: <https://www.rigkit.dev>
- Docs: <https://docs.rigkit.dev>
- Discord: <https://discord.com/invite/v5WT4fbXhc>

## What Rigkit Does

- Defines complete development environments with a typed TypeScript API.
- Runs setup as a workflow graph, with cache keys based on code, inputs,
  provider fingerprints, and upstream outputs.
- Creates named workspaces from prepared state, such as VM snapshots.
- Exposes project-defined workspace operations like `ssh`, `open-cmux`,
  `open-vscode`, `preview`, or anything else your project needs.
- Keeps provider resources and credentials behind provider-owned boundaries
  instead of baking them into project state.

Rigkit currently ships a Freestyle VM provider, a Freestyle browser-terminal
provider, a cmux integration, a local Google Cloud CLI config provider, a VS
Code host package, the `rig` CLI, and reusable workflow fragments.

## Install

Install the released CLI:

```sh
curl -fsSL https://www.rigkit.dev/install | sh
```

Open a new terminal, then verify the install:

```sh
rig version
```

You can also install the npm package directly:

```sh
npm install -g @rigkit/cli
```

## Quickstart

Create a project:

```sh
rig init website --package-manager pnpm
cd website
```

Plan and apply the workflow:

```sh
rig plan
rig apply
```

Create and manage a workspace:

```sh
rig create dev
rig ls
rig rm dev
```

The generated config prepares a Node.js 22 Freestyle VM and creates workspaces
from the cached snapshot. From there, add operations such as SSH, cmux, VS Code,
or preview URLs in `rigkit/index.ts`. See the
[Quickstart](https://docs.rigkit.dev/guides/quickstart) and
[workspace guide](https://docs.rigkit.dev/guides/workspaces) for the full loop.

By default, the Freestyle provider opens a browser login and stores
provider-owned host credentials outside project `.rigkit` state. Configs that
opt into API-key auth can pass `freestyle.provider({ apiKey })` or read
`FREESTYLE_API_KEY` from the environment.

## Repository Layout

```text
packages/sdk/                  project authoring API and project-local runtime
packages/engine/               workflow engine, provider contracts, and state
packages/runtime-client/       shared runtime daemon client
packages/cli/                  global `rig` command
packages/provider-freestyle/   Freestyle VM and terminal provider
packages/provider-cmux/        cmux host capability and provider facade
packages/provider-gcloud-cli/  local Google Cloud CLI config provider
packages/provider-vscode/      VS Code host extension package
packages/fragments/            reusable workflow fragments
apps/website/                  Astro website and install Worker
apps/docs/                     Mintlify documentation site
apps/app/                      placeholder for the future app
examples/                      runnable example Rigkit projects
docs/                          design and release notes
```

## Development

Prerequisites:

- Bun
- pnpm 9.x
- Node.js 22 or newer

Install dependencies:

```sh
corepack enable
pnpm install
```

Common checks:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Run a local example with the workspace CLI:

```sh
pnpm --dir examples/smoke exec rig plan
pnpm --dir examples/smoke exec rig apply
pnpm --dir examples/smoke exec rig create smoke-workspace
```

The `examples/` directory also includes a shared `.envrc` for direnv users. Once
allowed, plain `rig` inside an example resolves to that example's local CLI.

Run the website or docs locally:

```sh
pnpm --filter @rigkit/website dev
pnpm --filter @rigkit/docs dev
```

## Releases

Stable releases are version-branch driven and published from immutable `v*`
tags. Canary builds can be published from `main` for testing. See
[docs/release.md](docs/release.md) for the release model, release labels, and
maintainer workflows.

## Contributing

Issues and pull requests are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) for local setup, PR expectations, release
notes, and test guidance.

## License

Rigkit is licensed under the [MIT License](LICENSE).
