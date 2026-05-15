# Project Runtime Daemon and Host API Rewrite

Status: rewrite target. Current code may be incremental, but the desired end
state is a clean Effect v4 implementation with no compatibility fallback paths.

This is a rewrite-level design. It intentionally favors a cleaner architecture
over preserving the current CLI/engine boundary or command implementation.

The goal is to make the runtime authoritative while every host uses the same
Effect HTTP control API and WebSocket run/session bridge. Local projects use a
project-local daemon. Remote/team projects use an authenticated remote runtime.

```text
project dependency = authoring API + project-local runtime in one package
project runtime = local daemon for one Rigkit project, or remote hosted runtime
global rig binary = full terminal CLI host + bootstrap UX
other hosts = VS Code, cmux, web UI, prettier CLIs
runtime manager = shared local lifecycle client used by local hosts
remote runtime client = authenticated HTTP client for hosted/remote runtimes
control API = HTTP/OpenAPI surface for runtime/project/workspace/run resources
run session = WebSocket bridge for run events, prompts, host capabilities, cancel, heartbeat
```

The CLI and engine stay separate. The CLI does not own workflow behavior. The
engine does not own terminal UI. The runtime wraps the engine, exposes the
Effect `HttpApi`/OpenAPI surface, and owns interaction servers, OAuth/session
lifecycles, auth boundaries, state, and local daemon lifecycle when running
locally.

## Problem

Today the global CLI loads `rig.config.ts` and brings its own engine version.
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
  config-defined operations, provider behavior, and state schema.
- Use the Effect runtime HTTP control API as the only project command path.
- Use a WebSocket run session as the bidirectional bridge for run events,
  prompts, host capability requests/results, cancellation, and heartbeat.
- Ship the full CLI binary separately as a host that talks to runtimes over
  the runtime protocol.
- Let VS Code, cmux, and future hosts use the same local runtime manager and
  runtime protocol.
- Expose discoverable operations and schemas so hosts can render commands,
  forms, tree views, tab completion, and workspace actions generically.
- Keep project setup behavior on top-level commands such as `rig plan`,
  `rig apply`, and `rig create`; keep workspace behavior under
  `rig run <workspace> <operation>`.
- Keep host interactions small: messages, prompts, external opens, explicit
  local command execution, and locally registered trusted capabilities such as
  `cmux.open`.
- Let first-party integrations register typed host capabilities without baking
  those integrations into the engine.
- Avoid provider coupling to host protocol details.
- Make state location configurable so remote/cached projects do not need to
  store SQLite inside the checkout.
- Support a future remote hosted runtime where config, secrets, auth, and state
  live behind an authenticated HTTP API.
- Rewrite runtime, runtime-client, CLI host logic, and engine boundary code with
  Effect v4 so errors, dependencies, resource lifetimes, and concurrency are
  explicit without adding product-level abstractions too early.
- Use Effect CLI for the terminal CLI instead of Commander-style command
  plumbing.
- Use Drizzle for runtime-owned state schema, queries, and migrations.
- Keep Rigkit state schema and Drizzle migrations owned by Rigkit runtime/engine
  code. Provider packages can return durable JSON and may manage their own
  external service state, but they must not contribute rigkit database migrations.
- Keep provider/plugin packages such as `provider-freestyle` and
  `provider-cmux` out of the Effect rewrite unless they independently benefit from
  it later.

## Non-Goals

- Do not build a generic UI DSL.
- Do not make providers declare host protocol methods such as
  `message.show.v1`.
- Do not let remote runtimes or project configs install executable host
  capability handlers on the user's machine.
- Do not make generic local command execution the foundation for first-party
  integrations like cmux when a typed host capability is clearer.
- Do not make engine version equality a compatibility requirement.
- Do not recursively discover and run every config below cwd by default.
- Do not keep a separate one-shot project command path. Project commands go
  through the runtime protocol.
- Do not ship hardcoded project commands such as built-in `apply`, `plan`,
  `create`, `open`, `delete`, `fork`, or `ssh`. Those are runtime operations
  exposed by the loaded project.
- Do not make each host implement its own lifecycle rules.
- Do not add fallback paths to older boundaries. Missing runtime binaries,
  unsupported host methods, or incompatible runtime APIs should fail clearly.
- Do not make hosts read or write engine SQLite state directly.
- Do not let provider packages create or register rigkit Drizzle migrations.
- Do not send SQLite databases, SQLite hashes, or state diffs over normal
  command requests.
- Do not build Cloudflare Workers, Durable Objects, D1, hosted auth, or remote
  state transports in v1. Document the boundary now; implement those only when
  there is a concrete hosted runtime target.

## Package Boundary

Recommended package shape:

```text
@rigkit/sdk
  Public project dependency.
  Exports the authoring API used by rig.config.ts.
  Provides the project-local runtime binary.
  Depends on or includes the engine implementation.
  Owns the project behavior version boundary.

@rigkit/engine
  Programmatic engine library.
  Loads config, builds the operation registry, executes config-defined
  operations, manages state.
  Talks to a host adapter for messages, prompts, external opens, and privileged
  host capability requests.
  Uses Effect internally for engine/runtime boundaries and typed failure modes.

@rigkit/runtime-client
  Shared daemon manager/client.
  Computes project ids, reads handle files, uses lock files, health checks
  existing daemons, starts project-local daemons, and returns typed clients.
  Used by CLI, VS Code, cmux, and any other host.

@rigkit/cli
  Separately shipped full CLI binary.
  Discovers projects, asks the runtime client for a daemon, calls the runtime
  control API, renders terminal UX, handles bootstrap commands such as
  init/help/doctor.
  Uses Effect CLI for bootstrap command definition, parsing, help, and command
  programs, then dynamically renders project operations exposed by the runtime.

@rigkit/sdk-provider-*
  Provider packages.
  Integrate with the project-local runtime/engine APIs.
  Do not speak host HTTP directly.
  Do not need to be rewritten to Effect as part of this architecture rewrite.

@rigkit/provider-cmux
  First-party integration package.
  Exposes a config/runtime provider facade such as `providers.cmux.open(...)`.
  May also expose a local host capability handler, for example
  `@rigkit/provider-cmux/host`, that registers `cmux.open` with trusted local
  hosts.
  Remote runtimes can request `cmux.open`, but they cannot ship or install the
  local handler. The host decides whether that capability is available.
```

The rewrite should combine today's `@rigkit/sdk` and
`@rigkit/runtime` packages into `@rigkit/sdk`. Do not keep SDK
and runtime as separate public project dependencies. The config authoring API
and the runtime that executes that config should come from the same installed
project package.

That package can still have internal modules and can still depend on
`@rigkit/engine`, but users should install and import one project
package:

```ts
import { defineConfig, operation } from "@rigkit/sdk";
```

The ownership should not:

```text
runtime owns config execution, engine behavior, auth boundary, and state storage
engine owns workflow behavior and state semantics
runtime manager owns local daemon lifecycle
host owns presentation, user input, and local capability handlers
HTTP controls resources; WebSocket bridges active runs
```

## Core Boundaries

Keep these boundaries simple and strict:

```text
host = presentation, user input, local command consent, local capability handlers
runtime = HTTP control API, WebSocket run sessions, config loading, auth boundary, run lifecycle, state storage ownership
engine = workflow graph execution, provider runtime coordination, state schema semantics
provider = concrete infrastructure integration
state backend = runtime deployment detail
```

The host should never become a database client for engine state. Hosts inspect
state through runtime APIs such as `GET /workspaces`, `GET /runs`, and
`GET /snapshots`.

The runtime should never depend on terminal UI. It can request host behavior
through the run session bridge, but the host decides how to render prompts,
open external targets, execute local commands, or satisfy typed host
capabilities.

The engine should not know whether it is running behind the terminal CLI,
VS Code, cmux, a local daemon, or a hosted runtime. It receives services for
state, host interaction, local capability requests, providers, logging, and
time.

## No Fallback Policy

The rewrite should prefer clear failures over compatibility fallbacks.

Rules:

- Project commands have one path: host -> runtime protocol -> engine.
- Local project commands require the project-local runtime binary provided by
  `@rigkit/sdk`.
- If the project-local runtime binary is missing, fail and tell the user to
  install project dependencies.
- Hosts do not fall back to importing the engine directly.
- Hosts do not fall back to reading `.rigkit/state.sqlite`.
- Hosts do not fall back to bundled runtime code from the global CLI.
- Unknown host methods or host capabilities fail at the call site.
- Unsupported HTTP API versions fail at connection time.
- Remote runtimes do not get to install executable host capability code.
- Remote runtimes do not fall back to host filesystem state.

This keeps the product boundary boring. If something is unsupported, the host
should say exactly what is unsupported and where to upgrade or install.

## Effect v4 Structure

Use Effect v4 as the implementation structure for the rewrite. The goal is not
to make the product more abstract. The goal is to keep runtime dependencies,
errors, resource lifetimes, and concurrency explicit as the host/runtime split
grows.

Recommended rule:

```text
Effect for orchestration, resource scopes, typed errors, retries, services, and
concurrency.
Effect HttpApi for the runtime HTTP server, request routing, middleware,
schemas, typed clients, and OpenAPI surface.
Effect CLI for bootstrap/root command parsing, help, and dynamic project
operation dispatch.
Async TypeScript callbacks for public config steps, create handlers, and
operations.
Drizzle for runtime-owned database schema, queries, and migrations.
Plain TypeScript for small pure data transforms and simple formatting.
```

Effect should own the HTTP runtime surface through and through:
`HttpApi`, `HttpApiBuilder`, `HttpApiClient`, `HttpServer`, middleware,
request validation, response serialization, and OpenAPI generation.

Runtime protocol schemas should stay JSON-compatible and OpenAPI-friendly.
Effect Schema can be the source of truth for the core runtime HTTP API.

Do not make user config callbacks Effect-authored in v1. Public
`step`, `create`, and `operation.run` callbacks should be normal async
TypeScript. The runtime should normalize those registered callbacks into Effect
programs internally so it can supervise runs, enforce timeouts, emit events,
retry, clean up resources, and map failures consistently.

Provider packages should expose async SDK-like APIs to config authors. The
Freestyle provider should be a thin adapter over the Freestyle SDK; it should
not become a second Freestyle workflow DSL. The provider can wrap SDK calls in
Effect internally, but normal configs should call promise-based provider APIs.

Operation inputs should use Rigkit config helpers such as
`workflow.workspaceInput(...)` for common workspace-oriented cases. Those
helpers should lower to runtime schemas, completion metadata, and manifest
entries. Custom structured inputs can use rigkit input helpers later, but the
happy path should not require users to write Effect Schema.

Drizzle should own the database shape inside the runtime boundary. For the
local daemon, that means SQLite through a runtime `StateService`. For future
hosted runtimes, the same state semantics can be implemented with the storage
that fits that deployment. Where Drizzle has Effect-native integration, use it.
Where it does not, wrap the driver at the `StateService` layer rather than
leaking database details into hosts.

Providers should not care about Rigkit state by default. A provider can return
durable JSON from `create` or an operation, and rigkit persists that data in its
own workspace/run tables. A provider can also manage state in its own external
service if that service requires it. But provider packages must not create,
register, or run rigkit Drizzle migrations. The Rigkit runtime/engine owns Rigkit
state schema, migrations, and compatibility.

Do not Effect-rewrite provider/plugin packages as part of this work. The engine
can expose Effect-shaped services internally, but provider packages should keep
their current ergonomic integration surface unless a provider has a specific
reason to opt in.

Suggested service boundaries:

```text
RuntimeConfig       projectDir, configPath, state policy, runtime metadata
RuntimeManager      local handle/token/lock/start/health behavior
RuntimeHttpClient   authenticated HTTP/WebSocket client
OperationRegistry   config-defined operations and input validation
RunService          run records, event emission, host request correlation
RunSessionService   WebSocket run/session bridge, cancel, heartbeat
EngineService       load config, normalize async callbacks, and run operations
StateService        Rigkit-owned state reads/writes/migrations
HostService         messages, prompts, open.external, host.command.run, capability requests
HostCapabilityRegistry typed host capability declarations and runtime requests
AuthService         local bearer token now, real auth later
```

Avoid adding services before there is a real boundary. For example, do not add
a generic `StateBackend` abstraction in v1 if a Drizzle-backed `StateService`
with a configurable local SQLite path is enough. Do not add a remote state
protocol unless a remote runtime needs it in production.

Package shape with Effect:

```text
packages/sdk
  src/index.ts            public config authoring API
  src/config/sequence.ts  typed sequence/parallel/step/create/operation builders
  src/config/input.ts     workspaceInput and other public input helpers
  src/runtime/api.ts      Effect HttpApi definition
  src/runtime/http.ts     HttpApiBuilder handlers and error mapping
  src/runtime/layers.ts   runtime Effect layers
  src/runtime/ops.ts      config-defined operation registry and execution programs
  src/runtime/runs.ts     RunService
  src/runtime/sessions.ts WebSocket run/session bridge
  src/runtime/host.ts     host methods and host capability request protocol
  src/runtime/server.ts   Effect platform server resource/scope
  src/runtime/protocol.ts Effect schemas/constants for external protocol
  src/runtime/state.ts    Drizzle-backed StateService

packages/runtime-client
  src/manager.ts          RuntimeManager Effect program
  src/client.ts           RuntimeHttpClient
  src/session.ts          run session WebSocket client
  src/schemas.ts          handle/health/metadata schemas

packages/cli
  src/cli.ts              Effect CLI app definition
  src/commands.ts         bootstrap commands and dynamic operation dispatch
  src/host.ts             HostService implementation for terminal
  src/capabilities.ts     local host capability registry and trust policy
  src/render.ts           terminal rendering helpers

packages/sdk-provider-*
  no required Effect rewrite; keep provider integration APIs ergonomic

packages/provider-cmux
  src/index.ts            config/runtime provider facade
  src/host.ts             local `cmux.open` host capability handler
```

This is a structure target, not a requirement to split every file immediately.
The key is that the CLI should not become the engine, and the runtime should
not become a terminal UI.

## Public Config API

The public config API should stay async TypeScript first.

Hard requirements:

- Step output inference must remain as strong as the current builder system.
- `ctx` must evolve across sequence steps.
- Parallel branches must preserve named outputs.
- `create` receives the final sequence `ctx`.
- Workspace operations receive typed persisted workspace context.
- Effect environment types must not leak into normal config authoring.
- Provider SDKs should remain promise-based for config authors.

Internally, each registered callback is normalized to Effect:

```text
async step callback -> Effect.tryPromise(...)
async create callback -> Effect.tryPromise(...)
async operation callback -> Effect.tryPromise(...)
```

This gives the runtime Effect supervision without making configs Effect-heavy.
The runtime still owns resource scopes, retries, timeouts, cancellation around
runs, event streams, host requests, state transactions, and daemon lifecycle.

Advanced Effect escape hatches can be added later as explicit APIs such as
`stepEffect` or `operationEffect`, but they should not be part of the v1 happy
path.

## Command Flow

For a normal local project operation, assuming the runtime exposes an `apply`
operation:

```text
rig apply
  -> CLI discovers project/config
  -> CLI calls getOrStartRuntime(project)
  -> runtime manager reuses or starts the project daemon
  -> CLI asks the runtime for operations
  -> CLI matches the apply operation exposed by the runtime
  -> CLI calls POST /runs with operation apply
  -> CLI opens the run session WebSocket
  -> daemon loads config and runs engine
  -> daemon sends run events over the session
  -> daemon asks host for messages/prompts/external opens/commands/capabilities when needed
  -> CLI renders and answers those host requests over the session
```

There is no alternate one-shot project command path. If a host needs project
behavior, it uses the runtime protocol. Local projects go through the local
runtime manager and daemon. Remote projects go through an authenticated remote
runtime client.

Some bootstrap commands can still run inside the CLI without a daemon:

```text
rig init
rig help
rig version
rig doctor --cli
rig
```

## Project Discovery

Project discovery and runtime lifecycle are separate.

Project discovery:

1. `--config <file>` wins.
2. `-C/--project <dir>` wins.
3. Otherwise search upward from `cwd` for the nearest `rig.config.ts`.
4. If none is found, fail clearly.

Default project operations such as `rig apply` should not search downward
and run every config below cwd. That is surprising and risky because configs
are executable code.

Downward discovery should be explicit:

```bash
rig projects
rig plan --all
rig plan --discover
```

If multiple configs are found, the host should show candidates and require
selection unless `--all` is explicit.

## Local Runtime Manager

Every local host should use the same runtime manager. CLI, VS Code, and cmux
should not each invent their own daemon lifecycle implementation.

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

In this example, `apply` is an operation returned by the project runtime. The
runtime manager does not know or care whether `apply` is built from a common
SDK helper or project-specific code.

Responsibilities:

- Compute a stable project id.
- Resolve the project-local runtime binary from `@rigkit/sdk`.
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

Remote runtimes are different. A remote runtime is not started by the local
runtime manager. The host connects to it with an authenticated HTTP client:

```ts
const runtime = connectRemoteRuntime({
  url: "https://rigkit.example.com/projects/acme",
  token,
});
```

Remote runtime clients do not send `projectDir`, `configPath`, or `statePath`
from the local machine. Those paths only make sense on the machine or platform
where the runtime actually executes.

## Local Daemon Lifecycle

The daemon is one project runtime process for one project id.

Startup:

```text
runtime manager starts the @rigkit/sdk project-local runtime binary
runtime binds 127.0.0.1:0
OS assigns a free port
runtime creates a random bearer token
runtime writes handle file
runtime serves HTTP/OpenAPI and WebSocket run sessions
```

Handle file:

```json
{
  "projectId": "sha256:...",
  "projectDir": "/repo",
  "configPath": "/repo/rig.config.ts",
  "pid": 12345,
  "url": "http://127.0.0.1:49321",
  "tokenPath": "/Users/ben/.rigkit/runtimes/sha256....token",
  "engineVersion": "0.8.0",
  "runtimeVersion": "0.8.0",
  "startedAt": "2026-05-07T18:00:00.000Z",
  "expiresAt": "2026-05-07T18:30:00.000Z"
}
```

Handle location:

```text
~/.rigkit/runtimes/<project-id>.json
~/.rigkit/runtimes/<project-id>.token
~/.rigkit/runtimes/<project-id>.lock
```

Rules:

- The daemon must be started from the runtime binary installed by
  `@rigkit/sdk`.
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
  "configPath": "/repo/rig.config.ts",
  "engineVersion": "0.8.0",
  "runtimeVersion": "0.8.0",
  "expiresAt": "2026-05-07T18:30:00.000Z"
}
```

## Runtime Protocol

Use Effect HTTP/OpenAPI for the control plane and a WebSocket run session for
active runs because rigkit is moving toward long-lived, multi-host workflows:

- CLI commands
- shell completion
- VS Code tree views and buttons
- cmux workspace surfaces
- future browser UI
- future remote access
- actions against running workspaces

The runtime control API should be defined with Effect platform APIs:

```text
HttpApi          API definition
HttpApiBuilder   endpoint handlers
HttpApiClient    typed host/runtime control client
HttpServer       local daemon server
HttpApiSwagger or OpenApi helpers for docs/tooling
```

The runtime should expose:

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
WS   /runs/:runId/session
POST /shutdown
```

All non-health requests require the runtime token:

```http
Authorization: Bearer <token>
```

`/openapi.json` should describe the Effect HTTP control API for tooling and
future clients. `/operations` should describe project-specific operations and
their JSON schemas for hosts that want to render command UIs. The WebSocket run
session is part of the runtime protocol, but it does not need to be modeled as
normal request/response OpenAPI.

## Operations

Project behavior should be described as operations exposed by the runtime.
The runtime is authoritative because it loads the config, builds the operation
registry, validates operation inputs, and executes the callbacks. Host-side
validation is only UX.

The CLI must not hardcode project behavior such as `apply`, `plan`, `fork`,
`open`, `delete`, or `ssh`. Core operations can be derived by rigkit from
workflow steps and `.create(...)` definitions, but they still go through the
same operation manifest and `POST /runs` path as custom operations.

Recommended workflow shape:

```text
steps      build a reusable ctx
create     turns final ctx into persisted workspace ctx
operation  acts on persisted workspace ctx or other runtime inputs
```

`create` is not provider-owned. rigkit owns the workspace record and persistence.
The provider owns low-level resources such as Freestyle VMs. A create callback
returns durable JSON data; rigkit stores that data in SQLite as the workspace's
payload. Later operations select a workspace and receive that persisted data.

Conceptual config shape:

```ts
const website = sequence("website")
  .step("create-vm", async ({ providers }) => {
    const vm = await providers.freestyle.vms.create(vmSpec);
    return { vm: await vm.snapshotRef() };
  })
  .step("install", async ({ ctx, providers }) => {
    const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec(`cd ${ctx.repoPath} && pnpm install`);
    return { ...ctx, vm: await vm.snapshotRef(), devPort, devCommand };
  })
  .create(async ({ workflow, workspace, providers }) => {
    const vm = await providers.freestyle.vms.createFromSnapshot(workflow.ctx.vm);
    return {
      name: workspace.name,
      vmId: vm.id,
      sourceSnapshot: workflow.ctx.vm,
      repoPath: workflow.ctx.repoPath,
      devPort: workflow.ctx.devPort,
      devCommand: workflow.ctx.devCommand,
    };
  })
  .operation("open", {
    input: (workflow) =>
      workflow.workspaceInput({
        name: "workspace",
        description: "Workspace to open",
        position: 0,
      }),
    run: async ({ input, providers }) => {
      const workspace = input.workspace;
      const vm = await providers.freestyle.vms.get(workspace.ctx.vmId);
      await providers.cmux.open({
        name: workspace.name,
        ssh: await providers.freestyle.cmux.createSshOptions(vm),
        cwd: workspace.ctx.repoPath,
        terminals: [{ command: workspace.ctx.devCommand }],
        url: `http://localhost:${workspace.ctx.devPort}`,
      });
    },
  });
```

The exact authoring API can change. The boundary should not: project behavior
is registered by config, exposed by the runtime manifest, executed by the
runtime, and invoked by hosts through top-level project commands or
`rig run <workspace> <operation>`.

## Expected Config Example

This is the target authoring shape for the current Freestyle website example.
It is async TypeScript, not Effect-authored config.

```ts
import { defineConfig, env, sequence } from "@rigkit/sdk";
import { cmux } from "@rigkit/provider-cmux";
import { freestyle } from "@rigkit/provider-freestyle";
import { VmSpec } from "freestyle";

const repo = "freestyle-sh/freestyle-website-next";
const repoUrl = `https://github.com/${repo}.git`;
const repoPath = "/workspace/freestyle-website-next";
const devPort = 4321;
const devCommand = `pnpm dev -- --host 0.0.0.0 --port ${devPort}`;

const vmSpec = new VmSpec().additionalFiles({
  "/tmp/rigkit-ready.txt": { content: "ready" },
});

const website = sequence("website")
  .step("create-vm", async ({ providers }) => {
    const vm = await providers.freestyle.vms.create(vmSpec);

    return {
      vm: await vm.snapshotRef(),
    };
  })

  .step("github-auth", async ({ ctx, providers }) => {
    const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);

    const authenticated = await vm.probe(
      "gh auth status -h github.com >/dev/null 2>&1",
      { name: "check github auth" },
    );

    if (!authenticated.ok) {
      await providers.freestyle.terminal.open("Log in to GitHub", {
        target: vm,
        command: "gh auth login --hostname github.com --git-protocol https --web",
        instructions:
          "Complete the GitHub login, then return here after gh reports success.",
      });
    }

    return {
      vm: await vm.snapshotRef(),
    };
  })

  .step("clone", async ({ ctx, providers }) => {
    const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);

    const cloned = await vm.probe(`test -d ${shellQuote(repoPath + "/.git")}`, {
      name: "check repo checkout",
    });

    if (!cloned.ok) {
      await vm.exec(
        [
          "set -e",
          `mkdir -p ${shellQuote(dirname(repoPath))}`,
          `gh repo clone ${shellQuote(repo)} ${shellQuote(repoPath)}`,
        ].join("\n"),
        { name: "clone repo", timeoutMs: 5 * 60 * 1000 },
      );
    }

    await vm.exec(
      [
        "set -e",
        `cd ${shellQuote(repoPath)}`,
        `git remote set-url origin ${shellQuote(repoUrl)}`,
        "git fetch --prune origin",
        `git config --global --add safe.directory ${shellQuote(repoPath)}`,
      ].join("\n"),
      { name: "refresh repo", timeoutMs: 5 * 60 * 1000 },
    );

    return {
      vm: await vm.snapshotRef(),
      repoPath,
    };
  })

  .step("install", async ({ ctx, providers }) => {
    const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);

    await vm.exec(`cd ${shellQuote(ctx.repoPath)} && pnpm install`, {
      name: "install dependencies",
      timeoutMs: 10 * 60 * 1000,
    });

    return {
      vm: await vm.snapshotRef(),
      repoPath: ctx.repoPath,
      devPort,
      devCommand,
    };
  })

  .create(async ({ workflow, workspace, providers }) => {
    const vm = await providers.freestyle.vms.createFromSnapshot(workflow.ctx.vm);

    return {
      name: workspace.name,
      vmId: vm.id,
      sourceSnapshot: workflow.ctx.vm,
      repoPath: workflow.ctx.repoPath,
      devPort: workflow.ctx.devPort,
      devCommand: workflow.ctx.devCommand,
    };
  })

  .operation("open", {
    title: "Open",
    description: "Open the workspace in cmux and start the dev server",

    input: (workflow) =>
      workflow.workspaceInput({
        name: "workspace",
        description: "Workspace to open",
        position: 0,
      }),

    run: async ({ input, providers }) => {
      const workspace = input.workspace;
      const vm = await providers.freestyle.vms.get(workspace.ctx.vmId);

      const session = await providers.cmux.open({
        name: workspace.name,
        ssh: await providers.freestyle.cmux.createSshOptions(vm),
        cwd: workspace.ctx.repoPath,
        terminals: [{ command: workspace.ctx.devCommand }],
        url: `http://localhost:${workspace.ctx.devPort}`,
      });

      await session.closed;
    },
  })

  .operation("delete", {
    title: "Delete",
    description: "Delete a workspace",

    input: (workflow) =>
      workflow.workspaceInput({
        name: "workspace",
        description: "Workspace to delete",
        position: 0,
      }),

    run: async ({ input, providers }) => {
      await providers.freestyle.vms.delete(input.workspace.ctx.vmId);
    },
  })

  .operation("fork", {
    title: "Fork",
    description: "Fork an existing workspace into a new workspace",
    createsWorkspace: true,

    input: (workflow) =>
      workflow
        .workspaceInput({
          name: "from",
          description: "Workspace to fork",
          position: 0,
        })
        .extend({
          name: workflow.string({
            description: "New workspace name",
            position: 1,
          }),
        }),

    run: async ({ input, providers }) => {
      const source = input.from;
      const vm = await providers.freestyle.vms.get(source.ctx.vmId);
      const snapshot = await vm.snapshotRef();
      const forked = await providers.freestyle.vms.createFromSnapshot(snapshot);

      return {
        name: input.name,
        vmId: forked.id,
        sourceSnapshot: snapshot,
        repoPath: source.ctx.repoPath,
        devPort: source.ctx.devPort,
        devCommand: source.ctx.devCommand,
      };
    },
  });

export default defineConfig({
  providers: {
    freestyle: freestyle.provider({
      apiKey: env.secret("FREESTYLE_API_KEY"),
      image: "ubuntu-24.04",
    }),
    cmux: cmux.provider(),
  },

  workflows: {
    website,
  },
});

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
```

In this model:

```text
.step(...)      builds a reusable ctx/snapshot
.create(...)    creates a live workspace and returns durable JSON
.operation(...) acts on persisted workspace.ctx
```

rigkit persists the return value from `create` and from custom operations marked
with `createsWorkspace: true`. The Freestyle provider does not own Rigkit
workspace lifecycle; it only exposes Freestyle VM SDK operations.
It also does not own rigkit database shape. Provider output is durable JSON at
the rigkit boundary; Rigkit runtime/engine code owns how that JSON is stored,
indexed, migrated, and exposed through runtime APIs.

`providers.cmux.open(...)` is also not engine magic. It is a runtime/provider
facade that requests the typed `cmux.open` host capability over the active run
session. A local CLI host can satisfy that request by registering the
`@rigkit/provider-cmux/host` handler. VS Code can reject it, implement its
own equivalent, or render a clear unsupported-capability error. A remote
runtime may request `cmux.open`, but it cannot install executable cmux host code
on the user's machine.

Expected CLI shape:

```bash
rig apply --workflow website
rig create --workflow website --name ben-test
rig run ben-test open
rig run ben-test delete
rig run ben-test fork ben-copy
```

Example `GET /operations` response:

```json
{
  "hostMethods": {
    "known": [
      {
        "id": "host.command.run",
        "modes": ["capture", "interactive"]
      }
    ],
    "requiredByOperations": {}
  },
  "hostCapabilities": {
    "optional": [
      {
        "id": "cmux.open",
        "schemaHash": "sha256:cmux-open-schema"
      }
    ],
    "requiredByOperations": {
      "open": ["cmux.open"]
    }
  },
  "operations": [
    {
      "id": "apply",
      "kind": "command",
      "source": "core",
      "title": "Apply",
      "description": "Build the workflow source ctx",
      "cli": {
        "options": [
          {
            "name": "workflow",
            "flag": "--workflow",
            "required": true
          }
        ]
      },
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["workflow"],
        "properties": {
          "workflow": {
            "type": "string",
            "enum": ["website"],
            "description": "Workflow to apply"
          }
        }
      }
    },
    {
      "id": "create",
      "kind": "command",
      "source": "core",
      "title": "Create",
      "description": "Create a live workspace from a workflow",
      "createsWorkspace": true,
      "cli": {
        "options": [
          {
            "name": "workflow",
            "flag": "--workflow",
            "required": true
          },
          {
            "name": "name",
            "flag": "--name",
            "required": true
          }
        ]
      },
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["workflow", "name"],
        "properties": {
          "workflow": {
            "type": "string",
            "enum": ["website"],
            "description": "Workflow to create from"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "description": "Workspace name"
          }
        }
      }
    },
    {
      "id": "open",
      "kind": "workspace-action",
      "source": "config",
      "title": "Open",
      "description": "Open the workspace in cmux and start the dev server",
      "cli": {
        "positionals": [
          {
            "name": "workspace",
            "index": 0
          }
        ]
      },
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["workspace"],
        "properties": {
          "workspace": {
            "type": "string",
            "description": "Workspace to open",
            "x-rigkit-input": {
              "kind": "workspace",
              "workflow": "website",
              "resolve": "data"
            }
          }
        }
      }
    },
    {
      "id": "delete",
      "kind": "workspace-action",
      "source": "config",
      "title": "Delete",
      "description": "Delete a workspace",
      "cli": {
        "positionals": [
          {
            "name": "workspace",
            "index": 0
          }
        ]
      },
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["workspace"],
        "properties": {
          "workspace": {
            "type": "string",
            "description": "Workspace to delete",
            "x-rigkit-input": {
              "kind": "workspace",
              "workflow": "website",
              "resolve": "data"
            }
          }
        }
      }
    },
    {
      "id": "fork",
      "kind": "workspace-action",
      "source": "config",
      "title": "Fork",
      "description": "Fork an existing workspace into a new workspace",
      "createsWorkspace": true,
      "cli": {
        "positionals": [
          {
            "name": "from",
            "index": 0
          },
          {
            "name": "name",
            "index": 1
          }
        ]
      },
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["from", "name"],
        "properties": {
          "from": {
            "type": "string",
            "description": "Workspace to fork",
            "x-rigkit-input": {
              "kind": "workspace",
              "workflow": "website",
              "resolve": "data"
            }
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "description": "New workspace name"
          }
        }
      }
    }
  ]
}
```

`inputSchema` is runtime validation and generic form metadata. `cli` is
host-specific parse metadata projected by rigkit from input helpers such as
`position`. Keep them separate so non-CLI hosts do not need to understand CLI
argument parsing.

Operations that need privileged host behavior request it while the operation is
running. The host answers those requests with typed success or failure messages,
so unsupported capabilities fail at the call site rather than through a static
manifest preflight.

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
    "workflow": "website"
  }
}
```

Response:

```json
{
  "runId": "run_123",
  "operation": "apply",
  "status": "running",
  "sessionUrl": "/runs/run_123/session"
}
```

Hosts can use the same operations differently:

- CLI renders project operations as top-level commands and workspace operations
  under `rig run <workspace> <operation>`.
- VS Code renders config-defined operations as buttons/forms.
- cmux renders config-defined operations in its workspace UI.
- Shell completion calls `GET /workspaces` or `GET /operations`.

## Dynamic CLI Dispatch

The CLI should have a small static command surface for host, bootstrap, and
lifecycle behavior:

```text
init
help
version
projects
doctor
run
```

Workspace behavior lives under `run`:

```text
rig run <workspace> <operation> [...args]
```

Dispatch flow:

1. Parse bootstrap/global flags with Effect CLI.
2. If the command is `run`, discover the project.
3. Start or connect to the runtime.
4. Call `GET /operations`.
5. Match the token after `run` against runtime operation ids and aliases.
6. Parse the remaining argv using the operation schema and CLI metadata.
7. Check whether the host has the operation's required host methods and
   capabilities, including command modes such as `host.command.run:interactive`.
8. Call `POST /runs`.
9. Open the run session WebSocket and handle events, prompts, capability
   requests, cancellation, and heartbeat.

If the runtime does not expose the requested operation, fail clearly:

```text
This project does not define an Rigkit operation named "fork".
```

This keeps the CLI generic. It can still provide good help, validation, and tab
completion, but those are rendered from runtime metadata.

If the operation requires a host method or capability the current host has not
registered, fail before starting the run when possible:

```text
Operation "open" requires host capability "cmux.open".
Install or enable @rigkit/provider-cmux locally to use it from this host.
```

`apply` and `plan` are top-level CLI commands backed by runtime operations:

```bash
rig plan
rig apply
```

The SDK should reserve names that would collide with host-level commands. If a
config defines an operation named `init`, `doctor`, `projects`, `run`, `help`,
or `version`, it should fail at authoring/type-check time. If rigkit later adds a
new reserved host command, configs using that name should surface a type error
after the project package is upgraded.

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
      "ctx": {
        "vmId": "vm_123",
        "repoPath": "/workspace/freestyle-website-next",
        "devPort": 4321,
        "devCommand": "pnpm dev -- --host 0.0.0.0 --port 4321"
      },
      "updatedAt": "2026-05-07T18:00:00.000Z"
    }
  ]
}
```

This supports:

- CLI tab completion for config-defined operations such as
  `rig open <tab>` when the config exposes `open`.
- VS Code tree views.
- cmux workspace pickers.
- Future browser dashboards.

## Run Sessions And Host Capabilities

Runs should use a WebSocket session in v1. HTTP is the control plane; the
session is the bidirectional bridge while a run is active.

```http
WS /runs/run_123/session
Authorization: Bearer <token>
```

The session should start with a `hello` exchange. The host advertises the host
methods and typed capabilities it can satisfy, including schema hashes for
capabilities:

```json
{
  "type": "hello",
  "transportVersion": 1,
  "host": {
    "name": "rigkit-cli",
    "version": "0.8.0"
  },
  "hostMethods": [
    {
      "id": "open.external"
    },
    {
      "id": "host.command.run",
      "modes": ["capture", "interactive"]
    }
  ],
  "hostCapabilities": [
    {
      "id": "cmux.open",
      "schemaHash": "sha256:cmux-open-schema"
    }
  ]
}
```

The runtime can answer with its protocol metadata and the requirements for the
active operation:

```json
{
  "type": "hello.ack",
  "transportVersion": 1,
  "runtime": {
    "engineVersion": "0.8.0",
    "runtimeVersion": "0.8.0",
    "protocolHash": "sha256:runtime-known-protocol"
  },
  "operation": {
    "id": "open"
  }
}
```

If a requested capability name matches but the schema hash differs, fail when
executing that capability. Protocol hash drift can be diagnostic; capability
schema hash drift is a concrete incompatibility for that capability.

The session carries:

```text
run events
messages and prompts
open.external requests
host.command.run requests
typed host capability requests/results
run cancellation
heartbeat and disconnect handling
```

Run event example:

```json
{
  "type": "run.event",
  "event": {
    "type": "node.started",
    "nodePath": "repo.clone"
  }
}
```

Core host method request example:

```json
{
  "type": "host.request",
  "id": "host_req_123",
  "method": "open.external",
  "params": {
    "target": "http://127.0.0.1:43123",
    "kind": "url",
    "label": "Open interaction"
  }
}
```

All request responses use the same envelope:

```json
{
  "type": "response",
  "id": "host_req_123",
  "result": null
}
```

Typed host capability request example:

```json
{
  "type": "host.capability.request",
  "id": "cap_req_123",
  "capability": "cmux.open",
  "params": {
    "name": "ben-demo",
    "ssh": {
      "host": "127.0.0.1",
      "port": 49222,
      "username": "root"
    },
    "cwd": "/workspace/freestyle-website-next",
    "command": "pnpm dev -- --host 0.0.0.0 --port 4321",
    "url": "http://localhost:4321"
  }
}
```

Host capability response:

```json
{
  "type": "response",
  "id": "cap_req_123",
  "result": {
    "sessionId": "cmux_session_456"
  }
}
```

Cancellation flows over the same session:

```json
{
  "type": "run.cancel",
  "reason": "user"
}
```

If a host cannot handle a request:

```json
{
  "type": "response",
  "id": "cap_req_123",
  "error": {
    "code": "UNSUPPORTED_CAPABILITY",
    "message": "Operation \"open\" requires host capability \"cmux.open\". Install or enable @rigkit/provider-cmux locally to use it from this host."
  }
}
```

Host capability handlers are local trust decisions. First-party packages can
ship optional host handlers, but only the host process registers them. A remote
runtime or remote config can request `cmux.open`; it cannot cause arbitrary
cmux code to be installed or executed locally.

## Run Session Lifetime

The WebSocket session should be an attached-run channel, not the general
runtime API. Idle discovery, manifests, workspaces, and run records stay on
HTTP. A host opens a WebSocket only after `POST /runs` returns a `runId`.

Default v1 policy:

- Foreground CLI commands keep the session open until the run completes,
  fails, or is cancelled.
- Operations that use prompts, `open.external`, `host.command.run`, or typed
  host capabilities keep the session open while those host interactions may
  still be needed.
- If an operation awaits a host-owned resource, the WebSocket remains open for
  that lifetime. This is acceptable and should be treated as the normal model.

`await session.closed` from a provider facade such as `providers.cmux.open(...)`
means the operation is intentionally tied to a host-owned local resource. The
runtime should keep the run session attached so the host can report close,
cancel, errors, and cleanup. That is the right tradeoff for foreground commands
like `rig open`.

For hosted runtimes on Workers, accept that active sessions may be long-lived
and design the hosted implementation around that. Use a Durable Object session
coordinator with WebSocket hibernation so idle connections can stop accruing
duration while remaining connected. The protocol should not depend on Workers,
but the lifetime model should leave room for this deployment shape:

```text
HTTP control request -> Worker
active run/session   -> Durable Object WebSocket coordinator
runtime state        -> runtime-owned storage
```

## Host Methods And Registered Capabilities

Keep v1 core host-bound methods small and explicit:

```text
message.show
prompt.text
prompt.confirm
prompt.select
open.external
host.command.run
```

Typed host capabilities are separate from core host methods. They are named,
schema-checked integrations registered by the host:

```text
cmux.open
```

This distinction matters. `open.external` is a generic core method. `cmux.open`
is a local integration capability that can create cmux surfaces, terminals,
browsers, and close handling without forcing the engine to know cmux internals
or reducing cmux to a shell command.

The normal integration path should not be "send bash to the UI." The runtime
should send typed capability requests with JSON-compatible schemas. The host
can validate those requests, route them to a registered local handler, and show
a precise error when unsupported.

Arbitrary host commands are still part of the protocol. Some operations really
are local machine actions, and SSH is the obvious example. Those requests should
use `host.command.run` with structured `argv`, a visible reason, and host-side
permissioning. That keeps command execution explicit instead of smuggling it
through provider-specific labels.

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

Local command execution is a first-class privileged host method. It is useful
when the operation really needs a command on the user's machine: opening SSH,
running a local editor command, invoking a local auth helper, or calling a
tool that only exists on the host. It should be explicit and consent-based, not
hidden behind a vague integration label.

It should not be the foundation for first-party integrations like cmux when a
typed host capability can express the integration directly. But when the
product behavior is "run this command locally", the protocol should support it.

Request:

```json
{
  "method": "host.command.run",
  "params": {
    "argv": ["ssh", "-p", "49222", "root@127.0.0.1"],
    "cwd": "/Users/ben/project",
    "env": {},
    "stdin": null,
    "mode": "interactive",
    "reason": "Open an SSH session to workspace ben-demo",
    "presentation": {
      "visible": true,
      "label": "SSH into workspace"
    }
  }
}
```

Response:

```json
{
  "result": {
    "exitCode": 0,
    "stdout": null,
    "stderr": null
  }
}
```

For `mode: "capture"`, `stdout` and `stderr` should contain captured output.
For `mode: "interactive"`, output may be null because the host UI owns
presentation.

Use structured `argv`, not raw shell strings. If shell execution is truly
needed, make it explicit by using `argv: ["sh", "-lc", "..."]`; hosts can apply
stricter policy to shell-shaped commands.

`mode` should be explicit:

```text
capture      run command, capture stdout/stderr, return result
interactive  attach command to a visible terminal or host UI, return exit code after it exits
```

SSH should normally use `mode: "interactive"` so the user can see and control
the session. A headless check such as `gh auth status` can use
`mode: "capture"`.

Default host behavior should be to warn and ask:

```text
This Rigkit config is asking to run a command on this machine.
Command: ssh -p 49222 root@127.0.0.1
Reason: Open an SSH session to workspace ben-demo
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
- Remote runtime command requests are default-deny unless the host is
  interactive and can show the remote origin, project, command, cwd, env
  changes, mode, and reason before the user explicitly approves.
- Trusted remote runtimes may skip repeated prompts only after the user creates
  an explicit trust rule for that remote origin and command shape.
- Shell-shaped commands are treated as higher risk than direct `argv`.
- Interactive commands are treated as higher risk than captured commands.
- Show cwd and relevant env overrides when present.
- Log allowed command executions.
- Global config can suppress prompts for trusted projects, remotes, or command
  prefixes.
- Trust rules should be based on structured fields such as project id, runtime
  origin, argv prefix, cwd, env keys, and command mode. Do not trust opaque
  shell strings.

### cmux.open

`cmux.open` is the first concrete example of a registered host capability.
The config author calls the provider facade:

```ts
const session = await providers.cmux.open({
  name: workspace.name,
  ssh: await providers.freestyle.cmux.createSshOptions(vm),
  cwd: workspace.ctx.repoPath,
  terminals: [{ command: workspace.ctx.devCommand }],
  url: `http://localhost:${workspace.ctx.devPort}`,
});

await session.closed;
```

Under the hood, the runtime sends a `host.capability.request` for `cmux.open`.
The local host capability handler can use the cmux SDK, socket, or whatever
local API cmux exposes. That implementation detail stays out of the engine and
out of the project config.

The package can expose two sides:

```text
@rigkit/provider-cmux       config/runtime provider facade
@rigkit/provider-cmux/host  local host capability handler
```

Local hosts can register first-party capability handlers automatically when the
package is installed and trusted. Remote runtimes cannot install host handlers;
they can only request capabilities that the local host already supports.

Conceptual host registration:

```ts
import { defineHostCapabilities } from "@rigkit/sdk/host";
import { Schema } from "effect";
import { connectToLocalCmux } from "cmux";

const CmuxOpenInput = Schema.Struct({
  name: Schema.String,
  ssh: Schema.Struct({
    host: Schema.String,
    port: Schema.Number,
    username: Schema.String,
  }),
  cwd: Schema.String,
  terminals: Schema.Array(Schema.Struct({
    command: Schema.String,
    cwd: Schema.optional(Schema.String),
  })),
  url: Schema.String,
});

const CmuxOpenOutput = Schema.Struct({
  sessionId: Schema.String,
});

export const cmuxHostCapabilities = defineHostCapabilities({
  "cmux.open": {
    input: CmuxOpenInput,
    output: CmuxOpenOutput,
    handle: async (input) => {
      const cmux = await connectToLocalCmux();
      const session = await cmux.openWorkspace(input);
      return { sessionId: session.id };
    },
  },
});
```

The terminal CLI can bundle/register that handler:

```ts
import { cmuxHostCapabilities } from "@rigkit/provider-cmux/host";

const host = createCliHost({
  capabilities: [cmuxHostCapabilities],
});
```

The runtime only sees the declared capability name and schemas. The handler's
implementation stays local to the host process.

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
external target, call a registered typed capability, or run an explicitly
requested local command.

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
host method support = advertised in manifests, hello, and checked just in time
host capability support = advertised with schema hashes in manifests and hello
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
- If a required host capability schema hash differs, fail that operation or
  capability call instead of guessing compatibility.
- If required host methods or capabilities are known from the manifest, hosts
  should preflight them before starting a run.
- If an unknown host method or capability is requested during a run, fail at
  that call site.
- If `host.command.run` is requested, host policy decides whether to allow,
  deny, or prompt.
- If a host does not understand an operation-specific option, it can still
  render a generic JSON-schema form or omit optional fields.
- Runtime validation remains authoritative.

## Engine API Shape

The engine should still be usable directly in-process:

```ts
const engine = await createRigkitEngine({
  projectDir,
  configPath,
  state: stateService,
  host,
  providers,
});

await engine.load();

const operations = await engine.listOperations();
const run = await engine.runOperation({
  operation: "fork",
  input: { workflow: "website", name: "demo" },
});
```

In that example, `fork` is not a built-in engine command. It is an operation
the loaded config exposed. The engine may provide helpers for common behavior
such as applying a workflow, creating a workspace, or opening SSH, but those
helpers become commands only when the config exports operations that call them.

Engine constraints:

- No CLI parsing or command framework.
- No terminal formatting.
- No `process.exit`.
- No global CLI version assumptions.
- No hardcoded `.rigkit/state.sqlite`.
- No VS Code, cmux, HTTP server, or host-specific behavior.

The runtime wraps this library API with Effect `HttpApi`. The terminal CLI
wraps the runtime API with Effect CLI. The local runtime can build a
Drizzle-backed `StateService` from a `statePath`, but the engine should depend
on the state service rather than treating a SQLite path as its core state
boundary.

## State Location

State ownership depends on where the runtime runs.

The core rule:

```text
runtime and state are co-located
```

Local runtime:

```text
runtime process runs on the user's machine
state lives on the user's machine
default state = <project>/.rigkit/state.sqlite
optional override = host passes statePath when starting local runtime
```

Remote runtime:

```text
runtime process runs remotely
state lives remotely
host never sends a local statePath
host observes state through HTTP APIs
```

For local runtimes, state location should be configurable at the runtime layer:

```ts
createLocalRigkitRuntime({
  projectDir,
  configPath,
  statePath,
});
```

Default local project state can remain:

```text
<project>/.rigkit/state.sqlite
```

Managed local cache projects, such as downloaded GitHub tarballs, should live
outside the checkout:

```text
~/.rigkit/projects/<stable-project-id>/state.sqlite
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

Do not send SQLite bytes, hashes, or state deltas over normal runtime requests.
That turns state into a distributed sync protocol and makes every host part of
the database consistency story.

If a future deployment cannot use local SQLite, add a runtime-owned state
implementation behind the engine/runtime boundary. Do not make UI hosts write
engine state directly.

```text
v1 local runtime: SQLite file
future hosted runtime: Durable Object, D1, Postgres, or another runtime-owned store
```

Use Drizzle for this state layer:

```text
Drizzle schema = runtime-owned state schema source
Drizzle migrations = state migration path
StateService = Effect service around Drizzle queries/transactions
```

The host does not see Drizzle. The engine should talk to state through the
runtime's state service. The runtime can choose the concrete Drizzle driver or
hosted storage implementation for its deployment.

Rigkit runtime/engine code should own state schema and state semantics. The
runtime should own where that state is stored for its deployment. Hosts should
only choose state location when they are starting a local runtime. Providers
should not define rigkit tables or migrations. If provider-specific data needs to
be persisted in Rigkit state, the provider should return JSON through a
Rigkit-owned workflow or operation boundary, and rigkit should store it in
Rigkit-owned tables.

## Remote And Hosted Runtimes

A remote runtime is a first-class runtime, not a local daemon proxy.

In the remote shape:

```text
CLI / VS Code / cmux
  -> HTTPS + auth
  -> remote Rigkit runtime
      -> loads protected rig.config.ts
      -> owns secrets
      -> owns state
      -> runs engine
      -> serves HTTP control API and WebSocket run sessions
      -> exposes operations/workspaces/runs
```

This supports team workflows where employees do not need direct access to
`rig.config.ts`, provider credentials, or deployment secrets. The remote
runtime becomes the security boundary.

Rules:

- Remote runtimes own remote state.
- Remote runtimes own config loading.
- Remote runtimes enforce auth and authorization.
- Remote runtimes expose the same runtime protocol shape as local runtimes.
- Hosts do not send filesystem paths from the local machine.
- Hosts do not upload or download SQLite state as part of normal commands.
- Hosts can render only what the authenticated runtime exposes.

This also creates a natural hosted product boundary:

```text
hosted rigkit = remote runtime + auth/RBAC + protected config + managed state
```

## Cloudflare Workers Runtime Opportunity

A Workers deployment is an interesting future remote runtime target.

Conceptually:

```text
rigkit Worker runtime
  -> config bundled/deployed as an artifact
  -> secrets provided by Workers secrets
  -> auth handled at the runtime HTTP boundary
  -> state stored in Durable Objects, D1, R2, KV, or another Workers binding
  -> operations exposed through the same runtime protocol
```

The deployment artifact would likely include:

```text
rig.config.ts
provider/runtime code
operation manifest
HTTP runtime adapter
storage bindings
secret bindings
auth configuration
```

This should not be implemented in the local daemon rewrite. The important
boundary to preserve now is that runtime owns state and secrets. If the runtime
is deployed to Workers later, Workers bindings become the runtime's state and
secret implementations.

Do not design v1 around Workers constraints. Keep the local runtime simple, but
avoid decisions that would make a remote/Workers runtime impossible.

## Remote GitHub Repos

Remote repo support should use the same architecture.

Example:

```bash
rig <operation> github:owner/repo
```

Flow:

1. Resolve `owner/repo` and optional ref to a commit SHA.
2. Download a tarball/zipball into an rigkit cache directory.
3. Materialize it as a project directory.
4. Install dependencies if needed.
5. Start or reuse that cached project's runtime daemon.
6. Store state in `~/.rigkit/projects/<stable-project-id>/state.sqlite`.
7. Run the requested operation only if the remote config exposes it.

This is "without cloning" from the user's perspective, but the repo still must
be materialized somewhere so TypeScript imports and package resolution work.

Security note: loading a remote `rig.config.ts` executes code from that repo on
the user's machine. The CLI should make that explicit before running untrusted
remote configs.

## Diagnostics

`rig doctor` should make the split obvious:

```text
cli:              ~/.rigkit/bin/rig 0.4.0
project:          /repo
config:           /repo/rig.config.ts
runtime bin:      /repo/node_modules/.bin/rigkit-project-runtime
daemon:           http://127.0.0.1:49321
daemon pid:       12345
project package:  @rigkit/sdk 0.8.0
engine:           @rigkit/engine 0.8.0
api version:      1
cli protocol:     sha256:host-known-protocol
runtime protocol: sha256:runtime-known-protocol
state:            /repo/.rigkit/state.sqlite
expires:          2026-05-07T18:30:00.000Z
```

If protocol hashes differ but API version matches, `doctor` should say that
normal commands can still work and unsupported host methods or capabilities
will fail at the specific call site.

## Rewrite Plan

This should be treated as a rewrite, not an incremental compatibility project.

### Phase 1: Define Runtime Protocol

- Define the Effect `HttpApi` control API and `/openapi.json`.
- Define the WebSocket run/session protocol.
- Define attached run session lifetime, including operations that wait on
  host-owned resources such as `await session.closed`.
- Define auth token behavior.
- Define `/health`, `/runtime`, `/project`, `/operations`, `/runs`,
  `WS /runs/:runId/session`, run events, host requests, and host responses.
- Define the WebSocket `hello`/`hello.ack` exchange for host method and
  capability negotiation.
- Define v1 host methods.
- Define typed host capability registration, manifests, schema hashes, and
  request/response messages.
- Define operation manifest fields for CLI parse metadata.
- Define `host.command.run` policy and consent behavior.
- Add protocol hash metadata for diagnostics.
- Define local vs remote runtime connection shapes.
- Define how `rig.config.ts` contributes operations, operation input schemas,
  titles, descriptions, and workspace actions.
- Define the no-fallback policy in runtime/client behavior.

### Phase 2: Build Effect v4 Foundation

- Introduce Effect v4 for runtime, runtime-client, CLI command handlers, and
  engine boundary orchestration.
- Use Effect CLI for CLI command definitions, parsing, help, and command
  execution.
- Add typed errors for runtime startup, auth, HTTP protocol, operation
  validation, host request failures, and engine failures.
- Model daemon/server lifetimes with scoped resources.
- Use Effect platform as the runtime HTTP framework: `HttpApi`,
  `HttpApiBuilder`, `HttpApiClient`, `HttpServer`, middleware, validation,
  OpenAPI serving, and response serialization.
- Use Effect Schema as the core runtime HTTP API schema source of truth.
- Keep public config callbacks async-only in v1 and normalize registered
  callbacks into Effect internally.
- Add public config input helpers such as `workflow.workspaceInput(...)` that
  lower to runtime schemas, completion metadata, and OpenAPI/JSON Schema.
- Use Drizzle for runtime-owned state schema, queries, and migrations.
- Do not require `provider-freestyle`, `provider-cmux`, or other providers to
  be rewritten to Effect.

### Phase 3: Combine Project Package

- Rename or replace `@rigkit/sdk` with `@rigkit/sdk`.
- Move the project-local runtime entrypoint into `@rigkit/sdk`.
- Remove `@rigkit/runtime` as a separate public project dependency.
- Export the config authoring API and runtime binary from the same project
  package.
- Update examples, providers, docs, release config, and tests to import
  `@rigkit/sdk`.
- Keep `@rigkit/cli` separate.

### Phase 4: Build Local Runtime Manager

- Implement project id computation.
- Implement handle files, token files, and lock files.
- Implement get-or-start daemon logic.
- Implement health checks and stale handle cleanup.
- Require the project-local runtime binary from `@rigkit/sdk`; do not
  fall back to global CLI or bundled runtime code.
- Make CLI, VS Code, and cmux use this shared client rather than duplicating
  lifecycle code.

### Phase 5: Build Project-Local Daemon

- Add the project-local runtime daemon entrypoint inside `@rigkit/sdk`.
- Bind `127.0.0.1:0`.
- Serve the Effect HTTP control API and WebSocket run sessions.
- Load config and run the engine inside the daemon.
- Update `expiresAt`.
- Shut down after idle timeout when no runs/interactions are active.

### Phase 6: Refactor Engine Host And State Boundary

- Replace current ad hoc event and interaction hooks with a host adapter.
- Route user-visible messages, prompts, external opens, typed capabilities, and
  command requests through the host.
- Move provider-specific web terminal/session lifecycle into runtime helpers,
  with hosts only receiving `open.external`, messages, prompts, or explicit
  command requests.
- Add `statePath` to local runtime options.
- Make the engine depend on `StateService`, not a raw SQLite path.
- Move state reads/writes/migrations behind a Drizzle-backed runtime
  `StateService`.
- Keep rigkit Drizzle migrations in Rigkit runtime/engine packages only. Providers
  may return durable JSON but must not register rigkit migrations.
- Persist workspace context returned by `.create(...)` and by operations marked
  `createsWorkspace: true`.
- Keep state schema and state semantics inside engine/runtime code.
- Do not let hosts read or write SQLite state directly.

### Phase 7: Rebuild the CLI as a Host

- Keep the CLI as a separate compiled binary.
- Build command parsing/help/execution with Effect CLI.
- Discover projects/configs.
- Use the runtime manager for all project commands.
- Render project operations as top-level commands and workspace operations under
  `rig run <workspace> <operation>`.
- Treat `open`, `delete`, `fork`, and similar workspace verbs as runtime
  operation ids from `/operations`, not static CLI subcommands.
- Keep built-in project commands such as `apply`, `plan`, and `create` as thin
  aliases for runtime operations.
  matching operations.
- Reserve host-level command names such as `init`, `doctor`, `projects`, `run`,
  `help`, and `version` so configs cannot define conflicting operation ids.
- Render events and answer host requests.
- Open and maintain the run session WebSocket for active runs.
- Send WebSocket `hello` with supported host methods, command modes, and
  registered capability schema hashes.
- Fail typed host capability requests at the call site when the active host
  cannot support them.
- Keep the run session WebSocket open for operations that wait on host-owned
  resources such as `await session.closed`.
- Register trusted local host capability handlers such as `cmux.open`.
- Prompt for privileged local command execution and respect trust rules.
- Keep bootstrap commands such as `init`, `help`, and `version`.
- Split diagnostics clearly: CLI-only diagnostics can run without a runtime;
  project/runtime diagnostics connect through the runtime HTTP API.

### Phase 8: Add VS Code and cmux Hosts

- VS Code uses the runtime manager.
- VS Code renders operations as buttons/forms.
- VS Code renders `GET /workspaces` as tree views.
- VS Code handles prompts with native input UI.
- VS Code handles `open.external` with browser/webview/URI behavior.
- Hosts can implement only the capabilities they want. If VS Code does not
  support `cmux.open`, it can fail that operation clearly.
- cmux or the terminal CLI can register `cmux.open` and satisfy it with the
  local cmux SDK/socket.

### Phase 9: Remote Runtime And Hosted Runtime Shape

- Add `connectRemoteRuntime` as an authenticated HTTP client path.
- Do not send local `projectDir`, `configPath`, or `statePath` to remote
  runtimes.
- Keep remote state remote and runtime-owned.
- Add auth/RBAC at the runtime HTTP boundary.
- Define how remote runtimes expose project metadata without exposing protected
  config contents.

### Phase 10: Future Workers Deployment

- Define a deploy command or package flow that builds a Workers runtime artifact.
- Bind secrets through Workers secret management.
- Bind state through Durable Objects, D1, R2, KV, or another runtime-owned
  storage choice.
- Keep the same HTTP control API and WebSocket run/session protocol where
  possible.
- Treat this as a future deployment target, not a prerequisite for the local
  daemon rewrite.

## Open Questions

- What should the project-local runtime binary inside `@rigkit/sdk` be
  named? It should probably avoid colliding with the global `rig` host binary.
- Should `@rigkit/sdk` include `@rigkit/engine`, or should it
  depend on it as a separate package?
- Which bootstrap commands can run without a daemon?
- Should workflow authors be allowed to call prompts directly, or should
  prompts only be used by engine/provider-managed flows?
- How much CLI metadata should a config-defined operation expose beyond public
  input helper metadata: aliases, positional args, examples, grouping, hidden
  flags, or confirmations?
- Should operation aliases also be checked against reserved host-level command
  names, or only canonical operation ids?
- What should the protocol hash be generated from: Effect `HttpApi`/Schema
  definitions, generated OpenAPI, or a hand-maintained protocol manifest?
- What is the right idle timeout default?
- Which first-party host capabilities should the terminal CLI bundle or
  auto-register by default?
- How should local project capability handlers be discovered and trusted?
- Should third-party host capability handlers be allowed in v1, or should v1 be
  first-party only?
- What should the trust config format be for `host.command.run`?
- Which command fields are allowed in trust rules: argv prefix, cwd, env,
  project id, runtime origin, or all of them?
- What are the reconnect and cancellation semantics for WebSocket run sessions?
- What is the first real remote runtime deployment target?
- How should remote daemon access be authenticated and exposed?
- What storage should a hosted runtime use first: Durable Objects, D1, Postgres,
  or something else?
- Should remote runtimes expose source/config metadata, or only operations and
  derived project metadata?
- What is the right internal schema representation for public config input
  helpers when projecting operation manifests to OpenAPI/JSON Schema?
- Which Drizzle driver/storage target should the first hosted runtime use?

## Recommended Direction

Use the runtime protocol as the only project command path. For local projects, that
means a daemon-managed runtime binary from the project's installed
`@rigkit/sdk` package. For remote/team projects, that means an
authenticated remote runtime. Ship the full CLI binary separately from the
project package. Make that binary a host, not the source of workflow behavior.
Put the config authoring API, config loading, runtime behavior, provider
integration, state schema, interaction servers, auth boundaries, and workspace
actions behind the project/runtime boundary.

Use a shared runtime manager for lifecycle:

```text
handle file + token file + lock file + health check + port 0 + idle expiry
```

Do not add compatibility fallbacks:

```text
no global runtime fallback
no bundled runtime fallback
no direct engine import fallback
no direct SQLite read fallback
no SQLite-over-HTTP state sync
```

Use Effect HTTP/OpenAPI plus WebSocket for the runtime protocol:

```text
HTTP/OpenAPI control plane for workflows/workspaces/snapshots/runs
WebSocket run sessions for active runs
config-defined operations with schemas for commands and actions
CLI project behavior through top-level commands and rig run <workspace> <operation>
run events, prompts, external opens, host capabilities, cancellation, heartbeat
long-lived sessions are acceptable for operations awaiting host-owned resources
hello/hello.ack negotiates host methods, command modes, and capability schemas
```

Keep core host methods small and explicit:

```text
message.show
prompt.text
prompt.confirm
prompt.select
open.external
host.command.run
```

Use registered host capabilities for concrete local integrations:

```text
registered host capabilities such as cmux.open
```

Let the runtime own complex interaction servers and provider-specific flows.
Hosts should render progress, show messages, ask prompts, open external
targets, satisfy registered typed capabilities, run explicit local commands
under policy only when the product behavior is actually command execution, and
call documented operations. Normal integrations should not send bash to the UI.
That is enough for terminal CLI, VS Code, cmux, future browser UIs, and
eventual remote workspace access without coupling hosts to engine internals.

Use Effect v4 to structure the implementation, but keep the product model
simple:

```text
Effect services for real boundaries
Effect CLI for terminal command parsing/help/execution
Effect HttpApi/HttpApiBuilder/HttpApiClient for the runtime HTTP API
WebSocket run sessions for bidirectional active-run behavior
Drizzle for runtime-owned state
Effect Schema for core runtime protocol schemas
async TypeScript for public config callbacks
public input helpers for config-defined operation inputs
OpenAPI/JSON Schema for external hosts and tooling
runtime owns state
engine owns state semantics
providers do not create rigkit database migrations
host owns presentation
```

Do not turn provider/plugin packages into an Effect migration project. The
runtime and engine can be Effect-structured internally while
`provider-freestyle`, `provider-cmux`, and future provider packages keep a
simple integration surface.

The remote/hosted opportunity should build on the same boundary. A hosted
runtime can protect config and secrets, enforce auth, own remote state, and
expose the same operations API. A future Workers deployment can use Workers
secrets and Durable Objects/D1/R2/KV as runtime-owned implementations, but the
local daemon rewrite should not be blocked on that.
