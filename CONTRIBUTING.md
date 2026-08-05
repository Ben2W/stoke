# Contributing to Stoke

Stoke is an interview-scale product, so changes should keep the Vercel-only
architecture small and explicit.

## Local setup

Prerequisites are Bun, pnpm 9, and Node.js 22 or newer.

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Run the CLI from source with `pnpm --filter @usestoke/cli stoke -- --help` and the
dashboard with `pnpm --filter @usestoke/control-plane dev`.

## Boundaries

- Keep durable project, run, workspace, and cache state in Neon Postgres.
- Keep browser data access in TanStack Query through the Hono API.
- Keep provider code in `packages/provider-*` and host execution behind typed,
  locally trusted capabilities.
- Support Vercel Sandbox and cmux only; do not add a multi-cloud abstraction.
- Keep JSON-compatible data at engine and control-plane boundaries.
- Do not commit credentials, `.env` files, local logs, or generated deployment
  output.

Add or update tests for behavior changes and preserve the MIT license notice.
