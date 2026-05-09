# Project Runtime Daemon and Host API Rewrite

Status: initial Hono/Zod implementation in progress.

This is a rewrite-level design. It intentionally favors a cleaner architecture
over preserving the current CLI/engine boundary or command implementation.

The goal is to make the project-local runtime authoritative while every host
uses the same daemon-managed HTTP API.

```text
project dependency = SDK authoring API + engine/runtime + state schema
project runtime = local HTTP daemon for one fdev project
global fdev binary = full terminal CLI host + bootstrap UX
other hosts = VS Code, cmux, web UI, prettier CLIs
runtime manager = shared lifecycle client used by every host
```

The CLI and engine stay separate. The CLI does not own workflow behavior. The
engine does not own terminal UI. The runtime daemon wraps the engine, exposes
HTTP/OpenAPI, and owns local interaction servers, OAuth/session lifecycles,
ports, tokens, handle files, and idle shutdown.

## Problem

Today the global CLI loads `fdev.config.ts` and brings its own engine version.
The config imports project-local SDK and provider packages. That leaves the
compatibility boundary unclear:

- The config authoring API can come from the project.
- The engine consuming that config can come from the global CLI.
- Providers may assume details from either side.
- The CLI knows too much about engine behavior.
- A VS Code extension or cmux integration would need to duplicate CLI behavior
  or import engine internals directly.

The deeper issue is not "CLI version mismatch" by itself. The issue is that
the package which defines project behavior is not clearly the same package that
runs project behavior.

## Goals

- Make the project-local runtime the source of truth for config loading,
  planning, applying, forking, provider behavior, and state schema.
- Use daemon-managed local HTTP as the only project command path.
- Ship the full CLI binary separately as a host that talks to the daemon.
- Let VS Code, cmux, and future hosts use the same runtime manager and API.
- Expose discoverable operations and schemas so hosts can render commands,
  forms, tree views, tab completion, and workspace actions generically.
- Keep host interactions small: messages, prompts, external opens, and explicit
  local command execution.
- Avoid provider coupling to host protocol details.
- Make state location configurable so remote/cached projects do not need to
  store SQLite inside the checkout.

## Non-Goals

- Do not build a generic UI DSL.
- Do not make providers declare host protocol methods such as
  `message.show.v1`.
- Do not make engine version equality a compatibility requirement.
- Do not recursively discover and run every config below cwd by default.
- Do not keep a separate one-shot project command path. Project commands go
  through the daemon manager.
- Do not make each host implement its own lifecycle rules.

## Package Boundary

Recommended package shape:

```text
@freestyle-sh/fdev
  Public project dependency.
  Exports the authoring API used by fdev.config.ts.
  Depends on or includes the project-local engine/runtime.
  Provides the project-local daemon entrypoint.

@freestyle-sh/fdev-engine
  Programmatic engine library.
  Loads config, plans, applies, forks, manages state.
  Talks to a host adapter for messages, prompts, external opens, and privileged
  host commands.

@freestyle-sh/fdev-runtime-client
  Shared daemon manager/client.
  Computes project ids, reads handle files, uses lock files, health checks
  existing daemons, starts project-local daemons, and returns typed clients.
  Used by CLI, VS Code, cmux, and any other host.

@freestyle-sh/fdev-cli
  Separately shipped full CLI binary.
  Discovers projects, asks the runtime client for a daemon, calls HTTP API,
  renders terminal UX, handles bootstrap commands such as init/help/doctor.

@freestyle-sh/fdev-provider-*
  Provider packages.
  Integrate with the project-local runtime/engine APIs.
  Do not speak host HTTP directly.
```

Current implementation note: this repo still uses `@freestyle-sh/fdev-sdk` as
the authoring package and adds `@freestyle-sh/fdev-runtime` as the project-local
daemon package. Collapsing those names can happen later if the SDK package is
renamed.

The exact package names can change. The ownership should not:

```text
project-local runtime owns behavior
runtime manager owns lifecycle
host owns presentation
HTTP connects them
```

## Command Flow

For a normal project command:

```text
fdev apply
  -> CLI discovers project/config
  -> CLI calls getOrStartRuntime(project)
  -> runtime manager reuses or starts the project daemon
  -> CLI calls POST /runs with operation apply
  -> daemon loads config and runs engine
  -> daemon streams run events
  -> daemon asks host for messages/prompts/external opens/commands when needed
  -> CLI renders and answers those host requests
```

There is no alternate one-shot project command path. If a host needs project
behavior, it uses the runtime manager and daemon.

Bootstrap-only commands can still run inside the CLI without a daemon:

```text
fdev init
fdev help
fdev version
fdev doctor
```

## Project Discovery

Project discovery and runtime lifecycle are separate.

Project discovery:

1. `--config <file>` wins.
2. `-C/--project <dir>` wins.
3. Otherwise search upward from `cwd` for the nearest `fdev.config.ts`.
4. If none is found, fail clearly.

Default `fdev apply` should not search downward and run every config below cwd.
That is surprising and risky because configs are executable code.

Downward discovery should be explicit:

```bash
fdev projects
fdev plan --all
fdev apply --all
fdev apply --discover
```

If multiple configs are found, the host should show candidates and require
selection unless `--all` is explicit.

## Runtime Manager

Every host should use the same runtime manager. CLI, VS Code, and cmux should
not each invent their own daemon lifecycle implementation.

Conceptual API:

```ts
const runtime = await getOrStartRuntime({
  projectDir,
  configPath,
});

const workspaces = await runtime.get("/workspaces");
const run = await runtime.post("/runs", {
  operation: "apply",
  input: { workflow: "website" },
});
```

Responsibilities:

- Compute a stable project id.
- Resolve the project-local runtime binary.
- Fail if the project-local runtime binary is missing. Do not fall back to a
  global CLI runtime, bundled SDK runtime, or direct SQLite reads.
- Read the daemon handle file.
- Acquire a lock before starting a daemon.
- Health check existing daemons.
- Start a daemon when no healthy daemon exists.
- Wait for daemon readiness.
- Return an authenticated HTTP client.
- Clean stale handle files.

The manager is shared code. Hosts may initiate lifecycle, but they do not own
different lifecycle rules.

## Daemon Lifecycle

The daemon is one project runtime process for one project id.

Startup:

```text
runtime manager starts project-local runtime
runtime binds 127.0.0.1:0
OS assigns a free port
runtime creates a random bearer token
runtime writes handle file
runtime serves HTTP/OpenAPI
```

Handle file:

```json
{
  "projectId": "sha256:...",
  "projectDir": "/repo",
  "configPath": "/repo/fdev.config.ts",
  "pid": 12345,
  "url": "http://127.0.0.1:49321",
  "tokenPath": "/Users/ben/.fdev/runtimes/sha256....token",
  "engineVersion": "0.8.0",
  "runtimeVersion": "0.8.0",
  "startedAt": "2026-05-07T18:00:00.000Z",
  "expiresAt": "2026-05-07T18:30:00.000Z"
}
```

Handle location:

```text
~/.fdev/runtimes/<project-id>.json
~/.fdev/runtimes/<project-id>.token
~/.fdev/runtimes/<project-id>.lock
```

Rules:

- The daemon must be started from the project-local runtime binary.
- If the project-local runtime is missing, fail and ask the user to install
  project dependencies.
- Never use fixed ports. Always bind `127.0.0.1:0`.
- Treat the handle file as a hint, not truth.
- Always verify reuse with `GET /health`.
- If `expiresAt` is stale, health check once, then start a new daemon if the
  daemon is dead or does not match the project.
- If two hosts start at once, the lock file ensures only one daemon wins.
- The UI never reassigns ports. It asks the runtime manager for a runtime.
- The daemon updates `expiresAt` on requests, heartbeats, or active sessions.
- The daemon exits after idle timeout when no runs/interactions are active.

Health check:

```http
GET /health
Authorization: Bearer <token>
```

Example response:

```json
{
  "ok": true,
  "projectId": "sha256:...",
  "projectDir": "/repo",
  "configPath": "/repo/fdev.config.ts",
  "engineVersion": "0.8.0",
  "runtimeVersion": "0.8.0",
  "expiresAt": "2026-05-07T18:30:00.000Z"
}
```

## HTTP API

Use HTTP because fdev is moving toward long-lived, multi-host workflows:

- CLI commands
- shell completion
- VS Code tree views and buttons
- cmux workspace surfaces
- future browser UI
- future remote access
- actions against running workspaces

The daemon should expose:

```text
GET  /health
GET  /openapi.json
GET  /runtime
GET  /project
GET  /operations
GET  /workflows
GET  /workspaces
GET  /snapshots
GET  /runs
POST /runs
GET  /runs/:runId
GET  /runs/:runId/events
POST /host-responses/:requestId
POST /shutdown
```

All non-health requests require the daemon token:

```http
Authorization: Bearer <token>
```

`/openapi.json` should describe the HTTP API for tooling and future clients.
`/operations` should describe project-specific operations and their JSON
schemas for hosts that want to render command UIs.

## Operations

Commands, queries, and workspace actions should be described as operations.
The runtime is authoritative and validates every operation input. Host-side
validation is only UX.

Example `GET /operations` response:

```json
{
  "operations": [
    {
      "id": "plan",
      "kind": "command",
      "title": "Plan",
      "description": "Show cached and pending steps",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "workflow": {
            "type": "string",
            "enum": ["website", "worker"]
          }
        }
      }
    },
    {
      "id": "apply",
      "kind": "command",
      "title": "Apply",
      "description": "Resolve the workflow, running pending nodes",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "workflow": {
            "type": "string",
            "enum": ["website", "worker"]
          },
          "dryRun": {
            "type": "boolean",
            "default": false
          }
        }
      }
    },
    {
      "id": "fork",
      "kind": "command",
      "title": "Fork",
      "description": "Create a workspace from the resolved workflow artifact",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name"],
        "properties": {
          "workflow": {
            "type": "string",
            "enum": ["website", "worker"]
          },
          "name": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  ]
}
```

Run an operation:

```http
POST /runs
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "operation": "apply",
  "input": {
    "workflow": "website",
    "dryRun": false
  }
}
```

Response:

```json
{
  "runId": "run_123",
  "operation": "apply",
  "status": "running",
  "eventsUrl": "/runs/run_123/events"
}
```

Hosts can use the same operations differently:

- CLI renders `apply` as flags.
- VS Code renders `apply` as a button/form.
- cmux renders `apply` in its workspace UI.
- Shell completion calls `GET /workspaces` or `GET /operations`.

## Queries

Tab completion and native UIs need query endpoints. Do not force hosts to
parse command output.

Examples:

```http
GET /workflows
GET /workspaces
GET /snapshots
```

`GET /workspaces`:

```json
{
  "workspaces": [
    {
      "name": "ben-demo",
      "workflow": "website",
      "providerId": "freestyle",
      "resourceId": "vm_123",
      "snapshotId": "snap_456",
      "updatedAt": "2026-05-07T18:00:00.000Z"
    }
  ]
}
```

This supports:

- CLI tab completion for `fdev ssh <tab>`.
- VS Code tree views.
- cmux workspace pickers.
- Future browser dashboards.

## Run Events and Host Requests

Runs should stream events over Server-Sent Events first. WebSocket can be added
later if there is a concrete need for bidirectional streaming.

```http
GET /runs/run_123/events
Authorization: Bearer <token>
```

Event example:

```json
{
  "type": "node.started",
  "nodePath": "repo.clone"
}
```

Host request example:

```json
{
  "type": "host.request",
  "requestId": "host_req_123",
  "method": "open.external",
  "params": {
    "target": "http://127.0.0.1:43123",
    "kind": "url",
    "label": "Open interaction"
  }
}
```

Host response:

```http
POST /host-responses/host_req_123
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "result": null
}
```

If a host cannot handle a host request:

```json
{
  "error": {
    "code": "UNSUPPORTED_METHOD",
    "message": "This runtime requested host method open.external, but this host does not support it. Upgrade the host."
  }
}
```

## Host Methods

Keep v1 host-bound methods small and explicit:

```text
message.show
prompt.text
prompt.confirm
prompt.select
open.external
host.command.run
```

### message.show

```json
{
  "method": "message.show",
  "params": {
    "level": "info",
    "message": "Open the login page to continue."
  }
}
```

### prompt.text

```json
{
  "method": "prompt.text",
  "params": {
    "message": "Workspace name",
    "defaultValue": "demo"
  }
}
```

### prompt.confirm

```json
{
  "method": "prompt.confirm",
  "params": {
    "message": "Continue?",
    "defaultValue": true
  }
}
```

### prompt.select

```json
{
  "method": "prompt.select",
  "params": {
    "message": "Choose a workflow",
    "options": [
      { "value": "website", "label": "Website" },
      { "value": "worker", "label": "Worker" }
    ]
  }
}
```

### open.external

```json
{
  "method": "open.external",
  "params": {
    "target": "http://127.0.0.1:43123",
    "kind": "url",
    "label": "Open interaction"
  }
}
```

Hosts decide how to handle external targets:

- CLI can call `open`/`xdg-open` or print the URL.
- VS Code can open a browser, webview, URI, or file.
- cmux can open a browser surface or route the target into its workspace UI.

### host.command.run

Local command execution is useful for host integrations that are clearest as
real local commands, such as talking to the cmux socket through the cmux CLI or
SDK. It should be explicit and consent-based, not hidden behind a vague
integration label.

Request:

```json
{
  "method": "host.command.run",
  "params": {
    "argv": ["cmux", "new-workspace", "--name", "ben-demo"],
    "cwd": "/Users/ben/project",
    "env": {
      "CMUX_SOCKET_PATH": "/tmp/cmux.sock"
    },
    "stdin": null,
    "reason": "Create a cmux workspace for this fdev fork",
    "presentation": {
      "visible": true,
      "label": "Open cmux workspace"
    }
  }
}
```

Response:

```json
{
  "result": {
    "exitCode": 0,
    "stdout": "...",
    "stderr": ""
  }
}
```

Use structured `argv`, not raw shell strings. If shell execution is truly
needed, make it explicit by using `argv: ["sh", "-lc", "..."]`; hosts can apply
stricter policy to shell-shaped commands.

Default host behavior should be to warn and ask:

```text
This fdev config is asking to run a command on this machine.
Command: cmux new-workspace --name ben-demo
Reason: Create a cmux workspace for this fdev fork
Allow? [y/N]
```

Later, users can opt into trust rules:

```text
allow this command once
always allow this command for this project
trust this project
trust this remote runtime
deny
```

Policy rules:

- Default is prompt.
- Remote daemons always prompt unless explicitly trusted.
- Shell-shaped commands are treated as higher risk than direct `argv`.
- Show cwd and relevant env overrides when present.
- Log allowed command executions.
- Global config can suppress prompts for trusted projects, remotes, or command
  prefixes.

## Engine-Owned Interactions

Avoid `terminal.open` as a v1 host method.

Provider-specific interactive behavior should be owned by the runtime/engine,
not by every host. For example, if Freestyle needs a web terminal or login
session:

```text
provider asks engine for an interaction session
runtime starts the local server and bridges messages
runtime sends host request open.external with the local URL
host opens or prints the URL
runtime observes completion and continues
```

This keeps hosts generic. The host does not need to know how Freestyle terminal
sessions work. It only needs to know how to show a message, prompt, open an
external target, or run an explicitly requested local command.

Providers should call engine-level interaction APIs, not host HTTP methods:

```ts
await context.interactions.openExternal({ target: url, kind: "url" });
await context.interactions.showMessage({ level: "info", message });
```

The runtime maps those calls to host requests.

## Compatibility

Use simple compatibility rules:

```text
HTTP API version = hard compatibility gate
protocol hash = diagnostics and development drift signal
operation schemas = runtime-owned validation and host UX metadata
host method support = checked just in time
host command execution = privileged and policy-controlled
```

The runtime should expose version metadata:

```http
GET /runtime
```

```json
{
  "apiVersion": 1,
  "engineVersion": "0.8.0",
  "runtimeVersion": "0.8.0",
  "protocolHash": "sha256:runtime-known-protocol"
}
```

Rules:

- If the host cannot speak the daemon HTTP API version, it should fail and ask
  the user to upgrade.
- If protocol hashes differ but the API version matches, continue.
- Show hash drift in `doctor` or debug output, not during normal commands.
- If an unknown host method is requested during a run, fail at that call site.
- If `host.command.run` is requested, host policy decides whether to allow,
  deny, or prompt.
- If a host does not understand an operation-specific option, it can still
  render a generic JSON-schema form or omit optional fields.
- Runtime validation remains authoritative.

## Engine API Shape

The engine should still be usable directly in-process:

```ts
const engine = await createFdevEngine({
  projectDir,
  configPath,
  statePath,
  host,
  providers,
});

await engine.load();

const plan = await engine.plan();
const applied = await engine.apply();
const workspace = await engine.fork({ name: "demo" });
```

Engine constraints:

- No Commander.
- No terminal formatting.
- No `process.exit`.
- No global CLI version assumptions.
- No hardcoded `.fdev/state.sqlite`.
- No VS Code, cmux, HTTP server, or host-specific behavior.

The runtime daemon wraps this library API.

## State Location

State should be configurable:

```ts
createFdevEngine({
  projectDir,
  configPath,
  statePath,
});
```

Default local project state can remain:

```text
<project>/.fdev/state.sqlite
```

Remote/cached project state should live outside the checkout:

```text
~/.fdev/projects/<stable-project-id>/state.sqlite
```

The stable project id should include:

- canonical repo URL or local project path
- config path within the project
- ref policy
- resolved commit SHA when applicable

The state DB should store runtime metadata:

```text
runtime version
engine version
state schema version
project id
config path
source repo/ref/commit when applicable
```

State schema compatibility is the runtime's job. Host API compatibility should
not decide whether a SQLite DB is safe to open.

## Remote GitHub Repos

Remote repo support should use the same architecture.

Example:

```bash
fdev apply github:owner/repo
```

Flow:

1. Resolve `owner/repo` and optional ref to a commit SHA.
2. Download a tarball/zipball into an fdev cache directory.
3. Materialize it as a project directory.
4. Install dependencies if needed.
5. Start or reuse that cached project's runtime daemon.
6. Store state in `~/.fdev/projects/<stable-project-id>/state.sqlite`.

This is "without cloning" from the user's perspective, but the repo still must
be materialized somewhere so TypeScript imports and package resolution work.

Security note: loading a remote `fdev.config.ts` executes code from that repo on
the user's machine. The CLI should make that explicit before running untrusted
remote configs.

## Diagnostics

`fdev doctor` should make the split obvious:

```text
cli:              ~/.fdev/bin/fdev 0.4.0
project:          /repo
config:           /repo/fdev.config.ts
runtime bin:      /repo/node_modules/.bin/fdev-runtime
daemon:           http://127.0.0.1:49321
daemon pid:       12345
engine:           @freestyle-sh/fdev-engine 0.8.0
runtime:          @freestyle-sh/fdev-runtime 0.8.0
api version:      1
cli protocol:     sha256:host-known-protocol
runtime protocol: sha256:runtime-known-protocol
state:            /repo/.fdev/state.sqlite
expires:          2026-05-07T18:30:00.000Z
```

If protocol hashes differ but API version matches, `doctor` should say that
normal commands can still work and unsupported host methods will fail at the
specific call site.

## Rewrite Plan

This should be treated as a rewrite, not an incremental compatibility project.

### Phase 1: Define Runtime HTTP API

- Define the daemon HTTP API and `/openapi.json`.
- Define auth token behavior.
- Define `/health`, `/runtime`, `/project`, `/operations`, `/runs`, run events,
  and host responses.
- Define v1 host methods.
- Define `host.command.run` policy and consent behavior.
- Add protocol hash metadata for diagnostics.

### Phase 2: Build Runtime Manager

- Implement project id computation.
- Implement handle files, token files, and lock files.
- Implement get-or-start daemon logic.
- Implement health checks and stale handle cleanup.
- Make CLI, VS Code, and cmux use this shared client rather than duplicating
  lifecycle code.

### Phase 3: Build Project-Local Daemon

- Add a project-local runtime daemon entrypoint.
- Bind `127.0.0.1:0`.
- Serve the HTTP API.
- Load config and run the engine inside the daemon.
- Update `expiresAt`.
- Shut down after idle timeout when no runs/interactions are active.

### Phase 4: Refactor Engine Host Boundary

- Replace current ad hoc event and interaction hooks with a host adapter.
- Route user-visible messages, prompts, external opens, and command requests
  through the host.
- Move provider-specific web terminal/session lifecycle into runtime helpers,
  with hosts only receiving `open.external`, messages, prompts, or explicit
  command requests.
- Add `statePath` to engine options.

### Phase 5: Rebuild the CLI as a Host

- Keep the CLI as a separate compiled binary.
- Discover projects/configs.
- Use the runtime manager for all project commands.
- Render operations as terminal commands/flags.
- Render events and answer host requests.
- Prompt for privileged local command execution and respect trust rules.
- Keep bootstrap commands such as `init`, `help`, `version`, and `doctor`.

### Phase 6: Add VS Code and cmux Hosts

- VS Code uses the runtime manager.
- VS Code renders operations as buttons/forms.
- VS Code renders `GET /workspaces` as tree views.
- VS Code handles prompts with native input UI.
- VS Code handles `open.external` with browser/webview/URI behavior.
- cmux uses the runtime manager and maps `open.external` into cmux browser or
  workspace surfaces.

## Open Questions

- What should the project-local runtime binary be named?
- Should `@freestyle-sh/fdev` include `@freestyle-sh/fdev-engine`, or should it
  depend on it as a separate package?
- Which bootstrap commands can run without a daemon?
- Should workflow authors be allowed to call prompts directly, or should
  prompts only be used by engine/provider-managed flows?
- Should `/operations` be custom JSON Schema metadata, pure OpenAPI operation
  metadata, or both?
- What should the protocol hash be generated from: a checked-in OpenAPI file,
  TypeScript definitions, or a hand-maintained protocol manifest?
- What is the right idle timeout default?
- What should the trust config format be for `host.command.run`?
- Which command fields are allowed in trust rules: argv prefix, cwd, env,
  project id, runtime origin, or all of them?
- How should remote daemon access be authenticated and exposed later?

## Recommended Direction

Use daemon-managed local HTTP as the only project-runtime path. Ship the full
CLI binary separately from the SDK/runtime. Make that binary a host, not the
source of workflow behavior. Put config loading, engine behavior, provider
integration, state schema, interaction servers, and workspace actions in the
project-local runtime daemon.

Use a shared runtime manager for lifecycle:

```text
handle file + token file + lock file + health check + port 0 + idle expiry
```

Use HTTP/OpenAPI for the runtime API:

```text
resources for workflows/workspaces/snapshots/runs
operations with JSON schemas for commands and actions
SSE for run events
host responses for prompts, external opens, and command requests
```

Keep host methods small and explicit:

```text
message.show
prompt.text
prompt.confirm
prompt.select
open.external
host.command.run
```

Let the runtime own complex interaction servers and provider-specific flows.
Hosts should render progress, show messages, ask prompts, open external targets,
run explicit local commands under policy, and call documented operations. That
is enough for terminal CLI, VS Code, cmux, future browser UIs, and eventual
remote workspace access without coupling hosts to engine internals.
