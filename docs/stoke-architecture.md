# Stoke architecture

## Product boundary

Stoke is Rigkit's typed workflow engine plus a managed control plane. It has one
cloud platform: Vercel.

- The CLI discovers and evaluates `rigkit/index.ts` on the user's machine or in
  CI. The control plane never evaluates arbitrary project TypeScript.
- The control plane is a Next.js application on Vercel Functions.
- Durable managed data is Postgres supplied by Neon through the Vercel
  Marketplace.
- Cloud development environments run in Vercel Sandbox.
- cmux remains a first-class local host capability. A cloud service should not
  try to replace the user's terminal UI.

The inherited Cloudflare website and documentation applications are not Stoke
deployment targets. They will be removed or ported rather than supported as a
second platform.

## Domain model

A project is a durable managed identity. Its source is either:

- a GitHub repository, identified by owner and repository; or
- a local checkout, identified by machine and path.

Local checkouts are explicitly machine-scoped so the UI can say, for example,
`Benjamin's MacBook · ~/src/project` without pretending that path exists in the
cloud.

The initial API is intentionally small:

- `GET /api/v1/health`
- `GET /api/v1/projects`
- `POST /api/v1/projects`

Project endpoints require `STOKE_API_TOKEN`. `DATABASE_URL` must point at the
pooled Neon connection string. The schema is in
`apps/app/drizzle/0000_project_registry.sql`.

The CLI uses the same contract:

- `rig add owner/repository` registers a GitHub source.
- `rig add ./local-directory` registers a machine-scoped local source.
- `rig ls` lists managed projects when no Rigkit project is selected.
- `rig ls projects` always lists managed projects; `rig ls workspaces` keeps
  the existing project-runtime view.

The private-preview client reads `STOKE_API_URL` (defaulting to
`https://usestoke.dev`) and `STOKE_API_TOKEN` from the environment.

## Build order

1. Project registry, typed managed client, `rig add`, and project listing.
2. Replace the preview token with CLI authentication.
3. Vercel Sandbox provider for GitHub-backed projects.
4. Managed workflow state and shared cache metadata, keeping large cache
   artifacts in object storage rather than Postgres.
5. A CI adapter that invokes the same CLI and workflow graph as local usage.

## Deliberate cuts for the interview project

- No multi-cloud abstraction.
- No arbitrary TypeScript evaluation in the control plane.
- No dashboard before the CLI loop works.
- No organization/RBAC system in the first private preview; a scoped API token
  is sufficient.
- No replacement for GitHub Actions. Stoke first runs *inside* CI and shares
  project state and cache with local development.
- No global rewrite of Rigkit internals before the managed boundary proves what
  needs to change.
