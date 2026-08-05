# Stoke architecture

## Product boundary

Stoke is a typed workflow engine plus a managed control plane. It has one cloud
platform: Vercel.

- The CLI evaluates `stoke/index.ts` in a local checkout when one is available.
  Checkout-free `plan` and `apply` requests evaluate the same configuration in
  an isolated, ephemeral Vercel Sandbox; arbitrary project code does not run in
  the control-plane function itself.
- The control plane is a client-rendered React application served as a static
  Next.js shell on Vercel. Product API routes are composed in one Hono
  application and mounted through a single Vercel Function.
- Durable managed data is Postgres supplied by Neon through the Vercel
  Marketplace.
- Cloud development environments will run in Vercel Sandbox.
- cmux remains a first-class local host capability.

The product has no Cloudflare deployment surface.

## Project identity

A managed project is the durable identity for a codebase. A public GitHub repository is
the canonical source when one is available; it is not tied to any particular
filesystem path.

Each CLI installation registers a stable device identity. A checkout links one
managed project to one path on one device, so the same project can safely exist
at multiple paths on a MacBook, another computer, and a CI runner. The UI can
present `Benjamin's MacBook · /path/to/project` without implying that the path
is available to a cloud worker.

A Vercel Sandbox is an ephemeral executor, not a device or checkout. Remote runs
record whether they were initiated by the CLI or dashboard, but never create a
durable machine record. Git remains the source of truth for cloud execution;
the control plane clones the project's GitHub repository for each remote run.
Private repository access is deliberately out of interview scope: URL-based
registration verifies public visibility, and each remote run pins the public
repository's current default-branch commit.

Managed projects, devices, and checkouts belong to a Better Auth user. Project
slugs and source identities are unique within that user, while checkout paths
are unique per device.

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
- `POST /api/v1/projects/:projectId/executions`
- `GET /api/v1/projects/:projectId/workspaces`
- `GET /api/v1/projects/:projectId/cache`
- `POST /api/v1/projects/:projectId/cache/invalidate`
- `DELETE /api/v1/projects/:projectId/cache`
- `GET /api/v1/projects/:projectId/state`
- `PUT /api/v1/projects/:projectId/state`
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
projects, checkouts, workspaces, cache metadata, runs, run events, remote
execution mutations, and device authorization. Browser calls go through one
typed API client into Hono. Selecting a project opens the web management
surface: Plan, Apply, cache controls, independent workspace state, local
checkouts, and run history. WebSocket events update the same TanStack Query
cache rather than maintaining a second copy of run state.

React state is reserved for local presentation concerns such as search text,
view mode, and the selected run. Stoke does not use Next.js server actions or
server functions for product behavior.

## CLI semantics

- `stoke add owner/repository` registers a GitHub source.
- `stoke add ./local-directory` inspects its Git remote, registers or finds the
  managed project, and links that path as a checkout on the current device.
- A local single-workflow project defaults to the workflow name defined in
  `stoke/index.ts`; multi-workflow and remote-only projects default to the
  repository or directory name. `--name` overrides either default.
- Adding a new local checkout for an existing source or name prompts to attach
  it to the existing project or create a separate project with a different
  name. Non-interactive callers use `--project` or `--new --name`.
- `stoke use <project>` chooses the persistent current project. `stoke use
  --clear` removes that preference.
- `--project <id|slug|name|path>` and `STOKE_PROJECT` select a project for one
  invocation without changing the saved preference. Explicit CLI selection
  wins over the environment and saved selection.
- Runtime commands prefer the selected project's checkout on the current
  device and run from that path. Multiple checkouts require an explicit path.
  If a GitHub-backed project has no local checkout, `plan` and `apply` run in an
  ephemeral Vercel Sandbox. Host-bound workspace operations still require a
  local checkout.
- `stoke project ls` lists managed projects, their checkout locations, and the
  current selection. `stoke project rm` removes one managed project.
- `stoke ls` always lists the selected managed project. With a local checkout it
  follows with live workflow, cache, and workspace state; without one it shows
  the latest managed workflow activity without failing.
- `stoke discover` finds local Stoke configurations when that lower-level view is
  needed.
- Existing workspace commands (`stoke create`, `stoke run`, `stoke rm`) continue
  to use the local typed engine and retain cmux integration.

`STOKE_API_URL` defaults to `https://usestoke.dev`. `STOKE_TOKEN` is an explicit
credential override for automation; interactive use reads the credential written
by `stoke login`.

## Managed workflow state

Neon Postgres is the only durable workflow-state store. Each project owns one
versioned JSON snapshot containing workflow cache records, workspace metadata,
and provider storage, partitioned by engine scope. There is no SQLite database
and no durable state file in a checkout.

Workspaces are project state and are never owned by a machine. Each workspace
records creation provenance: either the local checkout that created it or the
Stoke dashboard. The project workspace endpoint resolves that provenance into
a safe metadata projection without exposing workspace context or the raw state
snapshot.

For a local command, the runtime reads the selected project's latest snapshot
from the Hono API, evaluates the TypeScript workflow locally, and commits the
updated snapshot with an expected revision. A revision conflict fails instead
of silently overwriting another command's work. A new revision also restarts a
stale local runtime before the next operation, so another device's cache writes
become visible.

For checkout-free execution, the control plane reads the same snapshot, passes
it into the Vercel Sandbox as a transient transport file, and commits the
returned snapshot to Postgres after a successful command. The transient file is
discarded with the Sandbox; it is not a second state store. Local development
and Vercel Sandbox therefore consume the same managed cache.

Remote CLI and dashboard requests dedupe against one project-level execution
scope, so the same active work is joined without inventing a cloud checkout.
The sandbox CLI publishes the same engine events produced by a local CLI to a
short-lived, run-scoped WebSocket implemented with Vercel's native Function
upgrade API. The control plane authenticates and persists each event in
Postgres before broadcasting it to dashboard viewers; terminal run completion
remains control-plane-owned. Reconnecting viewers replay the persisted event
log before receiving live events.

## Build order

1. Authenticated project, device, and checkout registry with deterministic CLI
   selection.
2. Vercel Sandbox execution for GitHub-backed projects, addressed by the same
   managed project identity. Plan and apply runs share the managed run model,
   dedupe active work, emit live events, and heartbeat until completion.
3. Managed workflow state and shared cache metadata in revisioned Postgres
   snapshots. The dashboard exposes safe cache inspection, downstream-aware
   invalidation, and clearing. Large binary artifacts remain provider-owned
   rather than being copied into Postgres.

## Deliberate interview-scope cuts

- No multi-cloud abstraction or Cloudflare deployment path.
- No arbitrary TypeScript evaluation in the control plane.
- No organization/RBAC model in the first private preview.
- No CI product surface in the interview project.
- No public package-release surface during the interview project.
