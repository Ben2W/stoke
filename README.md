# Stoke

Stoke is a managed development-environment control plane for local work, coding
agents, and CI. It keeps Rigkit's typed TypeScript workflow model and cmux
integration, while moving project registration, state, cache metadata, and
cloud execution to a service deployed exclusively on Vercel.

This private repository currently preserves the full history of
[Rigkit](https://github.com/freestyle-sh/rigkit), the MIT-licensed project from
which Stoke is derived. The original `@rigkit/*` internals intentionally remain
in place while the managed product boundary is built.

The first Stoke slice lives in:

- `apps/app`: Next.js product UI and a mounted Hono API on Vercel, with Better
  Auth and a Neon-backed Postgres project registry.
- `packages/managed`: versioned API contracts and the client the CLI will use.
- `apps/app/drizzle`: committed Postgres migrations.
- `packages/cli`: the `stoke` CLI, including device login and managed projects.

See [docs/stoke-architecture.md](docs/stoke-architecture.md) for the product
boundary and intentionally cut scope.

## Inherited Rigkit engine

Declarative dev environments, in TypeScript.

Rigkit lets you describe a development environment in `rigkit/index.ts`. Stoke
runs that engine through the `stoke` CLI and creates isolated named workspaces from cached
provider-owned artifacts. It is built for agent work, remote development, CI
jobs, and tests where the same environment has to be prepared once and reused
reliably.

- Website: <https://www.rigkit.dev>
- Docs: <https://docs.rigkit.dev>
- Discord: <https://discord.com/invite/v5WT4fbXhc>

## What Rigkit Does

- Defines complete development environments with a typed TypeScript API.
- Runs setup as a workflow graph, with cache keys based on code, inputs,
  scoped provider fingerprints, and upstream outputs.
- Creates named workspaces from prepared state, such as VM snapshots.
- Exposes project-defined workspace operations like `ssh`, `open-cmux`,
  `open-vscode`, `preview`, or anything else your project needs.
- Keeps provider resources and credentials behind provider-owned boundaries
  instead of baking them into project state.

The inherited engine currently ships a Freestyle VM provider, a Freestyle
browser-terminal provider, a cmux integration, a local Google Cloud CLI config
provider, a VS Code host package, and reusable workflow fragments.

## Private-preview CLI

The Stoke CLI is currently run from this private monorepo:

```sh
pnpm --filter @rigkit/cli stoke -- version
pnpm --filter @rigkit/cli stoke -- login
```

Register the current checkout and select its managed project:

```sh
stoke add .
stoke use stoke
stoke ls
```

Stoke records the project once in the managed service and links each local copy
as a checkout on a stable device identity. Use `--project <id|slug|name|path>`
for a one-command override without changing the saved selection.

## Quickstart

Create a project:

```sh
mkdir website
cd website
pnpm add -D @rigkit/sdk @rigkit/provider-freestyle @rigkit/provider-cmux freestyle
stoke init
```

Plan and apply the workflow:

```sh
stoke plan
stoke apply
```

Create and manage a workspace:

```sh
stoke create dev
stoke run dev ssh
stoke rm dev
```

The generated config prepares a Node.js 22 Freestyle VM, installs GitHub CLI,
authenticates `gh`, clones `octocat/Hello-World`, and creates workspaces from
the cached snapshot. It includes `ssh`, `open-cmux`, and `open-vscode`
operations in `rigkit/index.ts`. See the
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
packages/cli/                  global `stoke` command
packages/provider-freestyle/   Freestyle VM and terminal provider
packages/provider-cmux/        cmux host capability and provider facade
packages/provider-gcloud-cli/  local Google Cloud CLI config provider
packages/provider-vscode/      VS Code host extension package
packages/fragments/            reusable workflow fragments
apps/website/                  Astro website and install Worker
apps/docs/                     Mintlify documentation site
apps/app/                      Vercel control plane and Better Auth server
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
pnpm --dir examples/smoke exec stoke plan
pnpm --dir examples/smoke exec stoke apply
pnpm --dir examples/smoke exec stoke create smoke-workspace
```

The `examples/` directory also includes a shared `.envrc` for direnv users. Once
allowed, plain `stoke` inside an example resolves to that example's local CLI.

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
