# Stoke — Interview Project Notes

## Why I built it

Stoke explores a question: can one typed TypeScript definition describe the software environment used throughout the development lifecycle—from local development, to cloud workspaces and asynchronous agents, and eventually CI/CD?

Ironically Cloudflare's new [CI/CD product](https://blog.cloudflare.com/ci-workflows/) explores using TypeScript to define CI/CD environments in a very similiar way.

The public [`stoke-example`](https://github.com/Ben2W/stoke-example) repository shows the idea in practice. Its [`stoke/index.ts`](https://github.com/Ben2W/stoke-example/blob/main/stoke/index.ts) defines:

- a dependency graph that clones the repository, installs dependencies, and verifies the application;
- the Vercel Sandbox provider used to execute those tasks;
- snapshot-backed development workspaces created from the graph's final output; and
- typed workspace operations for previewing the app, opening SSH, running tests, and accepting structured input.

The goal is for tools to share the same environment definition rather than separately maintaining a local setup script, an agent image, and a CI configuration.

## Relationship to Rigkit

Stoke is intentionally a modified fork of [Rigkit](https://github.com/freestyle-sh/rigkit), a project I built a few months earlier.

Rigkit established the TypeScript authoring model, dependency-graph engine, task cache, workspace abstraction, providers, local runtime, CLI presentation. Its major problem was project state lived in local SQLite and the system assumed that execution was initiated from a local checkout. That worked well for local development, but it made cloud agents and CI/CD awkward.

For this project, I forked Rigkit and used its framework as the starting point. This let me spend the interview project on whether the same framework could become a managed, cloud-executed product.

## What I created for Stoke

- A managed control plane React Dashboard, and API deployed on Vercel and Neon Postgres.
- I modified Rigkit to read from the new API instead of local SQLite
- A cloud evaluator which loads and evaluates the repository's Stoke TypeScript definition.
- A managed Vercel Sandbox provider for creating environments, running commands, saving snapshots, restoring workspaces from snapshots, opening terminals, and exposing development ports.
- A capability protocol that separates workflow code from the host that fulfills an interaction. For example, the same operation can request a browser URL or terminal while the CLI and dashboard provide different host implementations.

## Package ancestry

The table below separates reused framework foundations from code created specifically for Stoke.

### Derived and modified from Rigkit

| Stoke package                                           | Rigkit foundation                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| [@usestoke/engine](./packages/engine)                   | Workflow authoring, DAG evaluation, caching, providers, and workspaces   |
| [@usestoke/sdk](./packages/sdk)                         | TypeScript authoring exports and the runtime server                      |
| [@usestoke/runtime-client](./packages/runtime-client)   | Local runtime discovery, loading, and client management                  |
| [@usestoke/cli](./packages/cli)                         | Terminal UI, runtime bootstrap, command structure, and completion system |
| [@usestoke/provider-cmux](./packages/provider-cmux)     | Rigkit's CMUX integration                                                |
| [@usestoke/provider-vscode](./packages/provider-vscode) | Rigkit's VS Code integration                                             |

### Created for Stoke

| Component                                                               | Purpose                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/app`](./apps/app)                                                | The Vercel-hosted control plane, Hono API, Better Auth integration, Drizzle/Postgres data layer, WebSocket run relay, persistent Sandbox evaluator, dashboard, cache DAG, workspace UI, and web terminal. |
| [@usestoke/managed](./packages/managed)                                 | Shared API contracts and authenticated client for projects, checkouts, state, Sandboxes, runs, events, and cache operations.                                                                              |
| [@usestoke/provider-vercel-sandbox](./packages/provider-vercel-sandbox) | The managed Vercel Sandbox implementation, including snapshots, restored workspaces, commands, ports, SSH, and dashboard/CLI host behavior.                                                               |
| [@usestoke/provider-browser](./packages/provider-browser)               | A provider-defined browser capability that can be fulfilled by either the local CLI or the dashboard.                                                                                                     |

I also removed many Rigkit packages that were unused in this project.
