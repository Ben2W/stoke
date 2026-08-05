# Stoke

Stoke is a managed development-environment orchestrator built for Vercel. A
TypeScript workflow defines cached setup work, workspaces, and operations. The
CLI evaluates that workflow locally or in Vercel Sandbox while the control
plane stores projects, runs, events, workspaces, and cache state in Postgres.

## Workspace

- `apps/app` — the Vercel-hosted control plane and SPA dashboard
- `packages/cli` — the `stoke` command
- `packages/engine` — workflow authoring and execution
- `packages/sdk` — project runtime and public workflow API
- `packages/runtime-client` — CLI-to-runtime transport
- `packages/managed` — shared control-plane API contracts
- `packages/provider-cmux` — trusted local cmux capability
- `packages/provider-vercel-sandbox` — Vercel Sandbox SDK and SSH capability

Every internal package is under the `@usestoke/*` scope. The removed Rigkit
website, Cloudflare deployment, public-package release automation, Freestyle,
Google Cloud, VS Code, fragments, and legacy examples are intentionally not
part of this interview project.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Run the dashboard with `pnpm --filter @usestoke/control-plane dev` and the CLI
from source with `pnpm --filter @usestoke/cli stoke -- --help`.

The control plane expects `DATABASE_URL` and the Better Auth environment
variables documented in `apps/app/.env.example`. Vercel Sandbox uses Vercel
OIDC in deployments or the standard Vercel SDK credentials locally.

## Origin

Stoke is derived from the MIT-licensed Rigkit project. The original copyright
notice remains in `LICENSE`; the active package namespace and product surface
are Stoke-owned.
