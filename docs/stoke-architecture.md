# Stoke architecture

## Product boundary

Stoke is Rigkit's typed workflow engine plus a managed control plane. It has one
cloud platform: Vercel.

- The CLI discovers and evaluates `rigkit/index.ts` on the user's machine or in
  CI. The control plane never evaluates arbitrary project TypeScript.
- The control plane is a Next.js application on Vercel Functions.
- Durable managed data is Postgres supplied by Neon through the Vercel
  Marketplace.
- Cloud development environments will run in Vercel Sandbox.
- cmux remains a first-class local host capability.

The inherited Cloudflare applications are not Stoke deployment targets. They
remain in the fork only while the product surface is extracted.

## Project identity

A managed project points to either a GitHub repository or a machine-scoped local
directory. A local source records both its machine name and absolute path, so the
UI can present `Benjamin's MacBook · /path/to/project` without implying that the
path is available to a cloud worker.

Managed projects belong to a Better Auth user. Slugs and source identities are
unique within that user, not globally.

## Authentication and API

The Vercel control plane self-hosts Better Auth against the linked Neon Postgres
database. GitHub is the browser identity provider. The CLI uses Better Auth's
OAuth device-authorization flow and bearer sessions:

1. `stoke login` requests a short-lived device code.
2. The browser signs in with GitHub and approves that terminal.
3. The CLI stores the resulting bearer session in a mode-`0600` credential file.
4. `stoke logout` revokes the server session and removes the local credential.

The initial API is deliberately small:

- `GET /api/v1/health`
- `GET /api/v1/auth/me`
- `GET /api/v1/projects`
- `POST /api/v1/projects`

Project and identity endpoints require an authenticated bearer session.
`DATABASE_URL` points at Neon; `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET` configure authentication.

## CLI semantics

- `stoke add owner/repository` registers a GitHub source.
- `stoke add ./local-directory` registers a machine-scoped local source.
- `stoke ls` always lists managed projects. It does not inspect a selected local
  runtime and has no `projects` or `workspaces` target.
- `stoke discover` finds local Stoke configurations when that lower-level view is
  needed.
- Existing workspace commands (`stoke create`, `stoke run`, `stoke rm`) continue
  to use the local typed engine and retain cmux integration.

`STOKE_API_URL` defaults to `https://usestoke.dev`. `STOKE_TOKEN` is an explicit
credential override for automation; interactive use reads the credential written
by `stoke login`.

## Build order

1. Authenticated project registry and deterministic CLI project listing.
2. Vercel Sandbox execution for GitHub-backed projects.
3. Managed workflow state and shared cache metadata, with large artifacts in
   object storage rather than Postgres.
4. A CI adapter that invokes the same CLI and workflow graph as local usage.

## Deliberate interview-scope cuts

- No multi-cloud abstraction or Cloudflare deployment path.
- No arbitrary TypeScript evaluation in the control plane.
- No dashboard before the CLI loop works.
- No organization/RBAC model in the first private preview.
- No GitHub Actions replacement; Stoke first runs inside CI.
- No global rewrite of inherited `@rigkit/*` internals.
