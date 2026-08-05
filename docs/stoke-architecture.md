# Stoke architecture

## Product boundary

Stoke is Rigkit's typed workflow engine plus a managed control plane. It has one
cloud platform: Vercel.

- The CLI discovers and evaluates `rigkit/index.ts` on the user's machine or in
  CI. The control plane never evaluates arbitrary project TypeScript.
- The control plane is a client-rendered React application served as a static
  Next.js shell on Vercel. Product API routes are composed in one Hono
  application and mounted through a single Vercel Function.
- Durable managed data is Postgres supplied by Neon through the Vercel
  Marketplace.
- Cloud development environments will run in Vercel Sandbox.
- cmux remains a first-class local host capability.

The inherited Cloudflare applications are not Stoke deployment targets. They
remain in the fork only while the product surface is extracted.

## Project identity

A managed project is the durable identity for a codebase. A GitHub repository is
the canonical source when one is available; it is not tied to any particular
filesystem path.

Each CLI installation registers a stable device identity. A checkout links one
managed project to one path on one device, so the same project can safely exist
at multiple paths on a MacBook, another computer, and a CI runner. The UI can
present `Benjamin's MacBook · /path/to/project` without implying that the path
is available to a cloud worker.

Managed projects, devices, and checkouts belong to a Better Auth user. Project
slugs and source identities are unique within that user, while checkout paths
are unique per device. The project source still accepts the original local
shape for backwards compatibility; new local registrations use checkouts as
the authoritative location mapping.

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
- `DELETE /api/v1/projects/:projectId`
- `POST /api/v1/devices`
- `GET /api/v1/checkouts`
- `POST /api/v1/checkouts`
- `GET /api/v1/runs`
- `GET /api/v1/runs/:runId/events`
- `POST /api/v1/runs/:runId/ticket`

The `/api/v1` surface is a Hono router with shared authentication and error
handling, mounted at `app/api/v1/[[...route]]/route.ts`. Better Auth retains its
own `/api/auth/*` handler because it owns that browser and device protocol.

Project and identity endpoints require an authenticated bearer session.
`DATABASE_URL` points at Neon; `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET` configure authentication.

The root web experience is public when signed out and becomes a managed project
dashboard when a Better Auth browser session is present.

## Frontend boundary

The product UI is a SPA. Next.js serves the static application shell and mounts
the Hono and Better Auth handlers; React components do not import control-plane
services, repositories, or database code.

TanStack Query owns all remote browser state, including the current user,
projects, checkouts, runs, run events, and device authorization. Browser calls
go through one typed API client into Hono. WebSocket events update the same
TanStack Query cache rather than maintaining a second copy of run state.

React state is reserved for local presentation concerns such as search text,
view mode, and the selected run. Stoke does not use Next.js server actions or
server functions for product behavior.

## CLI semantics

- `stoke add owner/repository` registers a GitHub source.
- `stoke add ./local-directory` inspects its Git remote, registers or finds the
  managed project, and links that path as a checkout on the current device.
- Adding another checkout for an existing repository links it automatically.
  Ambiguous name collisions require an explicit link or `--new`.
- `stoke use <project>` chooses the persistent current project. `stoke use
  --clear` removes that preference.
- `--project <id|slug|name|path>` and `STOKE_PROJECT` select a project for one
  invocation without changing the saved preference. Explicit CLI selection
  wins over the environment and saved selection.
- Runtime commands resolve the selected project's checkout on the current
  device and run from that path. Multiple checkouts require an explicit path;
  a missing checkout produces an attach command instead of guessing.
- `stoke ls` always lists managed projects, their checkout locations, and the
  current selection. It does not double as a workspace listing command.
- `stoke discover` finds local Stoke configurations when that lower-level view is
  needed.
- Existing workspace commands (`stoke create`, `stoke run`, `stoke rm`) continue
  to use the local typed engine and retain cmux integration.

`STOKE_API_URL` defaults to `https://usestoke.dev`. `STOKE_TOKEN` is an explicit
credential override for automation; interactive use reads the credential written
by `stoke login`.

## Build order

1. Authenticated project, device, and checkout registry with deterministic CLI
   selection.
2. Vercel Sandbox execution for GitHub-backed projects, addressed by the same
   managed project identity.
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
