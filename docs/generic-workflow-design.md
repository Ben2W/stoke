# Generic Workflow Design

Status: design note, not implemented.

This redesign makes `rig` a generic workflow runner instead of a VM-specific
step runner. The current Freestyle VM flow should become one provider-backed
workflow shape, not the core abstraction.

This is a rewrite-level design. It should not be treated as a small evolution of
the existing `defineDevMachine`, `defineStep`, VM provider, and prefix snapshot
engine. The SDK, engine state model, provider contract, cache planner,
interaction boundary, CLI plan/apply behavior, and Freestyle provider helpers
all need to be redesigned together around workflow nodes, durable provider refs,
and graph-based cache reuse.

## Goals

- Make the public API easy to demo and reason about.
- Model work as typed tasks composed with `sequence` and `parallel`.
- Keep Freestyle powerful through provider helper tasks, snapshots, terminals,
  and workspace helpers.
- Let other providers, such as Neon, Daytona, Docker, or local resources, plug
  into the same workflow/cache model.
- Avoid serializing functions. Persist only JSON outputs and provider artifact
  references.
- Make cache invalidation graph-based instead of linear suffix-based.

## Core API Shape

A workflow owns provider names and types. Tasks created from the workflow can
receive typed providers directly.

```ts
const app = workflow("website", {
  providers: {
    freestyle: freestyle.provider(),
    terminal: freestyle.terminal(),
    db: neon.project(),
  },
});
```

The main composition API is fluent:

```ts
const baseVm = app
  .sequence("base-vm")
  .task("create", async ({ freestyle }) => {
    const vm = await freestyle.vms.create({ image: "ubuntu-24.04" });
    return { vm: await vm.snapshotRef() };
  })
  .task("install-toolchain", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec("apt-get update && apt-get install -y git gh");
    return { vm: await vm.snapshotRef() };
  })
  .task("install-bun", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec("curl -fsSL https://bun.sh/install | bash");
    return { vm: await vm.snapshotRef() };
  });

const repo = app
  .sequence("repo")
  .task("clone", async ({ ctx, freestyle, terminal }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await terminal.open("Log in to GitHub", {
      target: vm,
      command: "gh auth login --web",
    });

    await vm.exec("gh repo clone freestyle-sh/app /workspace/app");
    return {
      repoPath: "/workspace/app",
      vm: await vm.snapshotRef(),
    };
  })
  .task("install", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec(`cd ${ctx.repoPath} && bun install`);
    return {
      devPort: 4321,
      vm: await vm.snapshotRef(),
    };
  });

const database = app
  .sequence("database")
  .task("branch", async ({ db }) => {
    const branch = await db.createBranch();
    return { databaseUrl: branch.url };
  })
  .task("migrate", async ({ ctx, db }) => {
    await db.migrate(ctx.databaseUrl);
  });

export default app
  .sequence("website")
  .add(baseVm)
  .parallel({
    repo,
    database,
  })
  .task("open-workspace", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.repo.vm);
    const url = await freestyle.vscode.createUrl(vm, { cwd: ctx.repo.repoPath });
    return { url };
  });
```

`sequence`, `parallel`, and task builders all produce nodes. A node can be
stored in a variable, exported, and composed later with `.add(node)`.

## Node Semantics

The runtime has three node types:

- `task`: a leaf unit of work.
- `sequence`: ordered composition. Each child receives the accumulated context
  from previous children.
- `parallel`: unordered branches. Each branch receives the same upstream
  context. The join output is namespaced by branch name.

Example:

```ts
app.sequence("website")
  .add(baseVm)
  .parallel({
    repo,
    database,
  })
  .task("open-workspace", ...);
```

This resolves to a graph like:

```text
baseVm -> repo ----\
        -> database -> open-workspace
```

`sequence` and `parallel` are the primary authoring model. Internally, they can
compile into a DAG. An explicit `needs` escape hatch can be added later if real
workflows need arbitrary cross-branch edges, but it should not be the demo path.

Sequences should pass resource state explicitly through JSON context. For
Freestyle, that usually means a task consumes a VM snapshot ref, creates a VM
from it, mutates that VM, and returns a new snapshot ref. This keeps VM lineage
visible in the workflow output and supports workflows that end with multiple VM
snapshots instead of one implicit global VM.

## Task Context

Tasks receive:

- `ctx`: accumulated upstream JSON context.
- flattened workflow providers, such as `freestyle`, `terminal`, and `db`.
- optional low-level runtime helpers if needed by provider helper tasks.

There is no `uses` or `requiredProviders` option in the default API. The workflow
owns provider names, and tasks can destructure the providers they need.

For v1, cache can conservatively treat every task as depending on the workflow's
provider fingerprint. Later, rigkit can optimize this with explicit provider
scoping or runtime provider access tracking if unnecessary reruns become a real
problem.

## TypeScript Model

Workflow-scoped builders carry provider and context types forward.

```ts
app.sequence("repo")
  .task("clone", async () => {
    return { repoPath: "/workspace/app" };
  })
  .task("install", async ({ ctx }) => {
    ctx.repoPath; // inferred as string
  });
```

Builder tasks can infer outputs from the handler return type. They should not
need required input/output schemas in the common case.

Zod schemas are still useful as optional runtime validation:

```ts
app.task("clone", {
  output: z.object({ repoPath: z.string() }),
}, async () => {
  return { repoPath: "/workspace/app" };
});
```

If an output schema is present:

- fresh task output is parsed before caching;
- cached output is parsed before reuse;
- schema parse failure is treated as a cache miss.

Task outputs must be JSON-serializable. Functions should not be returned from
tasks because cached tasks may be reused in a later process where the function
does not exist. Callable behavior belongs in providers or imported helpers.

## Durable Provider Refs

Provider runtime objects can be rich objects with methods. Task outputs cannot.
Task outputs must persist through SQLite and process restarts, so they should
store provider refs, not live provider objects.

This is the durable shape:

```ts
type FreestyleVmSnapshotRef = {
  provider: "freestyle";
  kind: "vmSnapshot";
  snapshotId: string;
};
```

A task can use a rich VM object while it runs:

```ts
const vm = await freestyle.vms.fromSnapshot(ctx.vm);
await vm.exec("bun install");
```

But it should return a serializable ref:

```ts
return {
  vm: await vm.snapshotRef(),
};
```

It should not return an object whose useful behavior comes from functions:

```ts
return {
  vm: await vm.snapshot(), // bad if this returns methods like createVm/delete
};
```

Cached task outputs are read back from SQLite for later `plan`, `apply`, `fork`,
workspace creation, failed-run resume, and any fresh process that needs context
from cached upstream tasks. Functions cannot be reconstructed in those cases.

Providers can still make the common case ergonomic by rehydrating refs into rich
runtime objects before invoking a helper task, then converting the result back to
refs after the helper task completes.

## Reusable Nodes

Reusable generic nodes should usually be factories that bind to a workflow.

```ts
export function nodeProject(input: {
  repo: string;
  path: string;
}) {
  return <Providers extends { freestyle: FreestyleProvider }>(app: App<Providers>) =>
    app
      .sequence("node-project")
      .task("clone", async ({ ctx, freestyle }) => {
        const vm = await freestyle.vms.fromSnapshot(ctx.vm);
        await vm.exec(`git clone ${input.repo} ${input.path}`);
        return {
          repoPath: input.path,
          vm: await vm.snapshotRef(),
        };
      })
      .task("install", async ({ ctx, freestyle }) => {
        const vm = await freestyle.vms.fromSnapshot(ctx.vm);
        await vm.exec(`cd ${ctx.repoPath} && bun install`);
        return { vm: await vm.snapshotRef() };
      });
}
```

Usage:

```ts
const setupProject = nodeProject({
  repo: "https://github.com/freestyle-sh/app",
  path: "/workspace/app",
});

export default app.sequence("website")
  .add(setupProject(app));
```

This avoids circular typing. The factory can require a provider shape and return
a node that composes with any workflow that provides the expected capability.

## Provider Helper Tasks

Provider-specific cache behavior should be packaged as provider helper tasks or
node factories, not pushed into every generic task option.

Examples:

```ts
const vmLineage = freestyle.vmLineage({ image: "ubuntu-24.04" });

app.sequence("base-vm")
  .add(vmLineage.tasks.create())
  .add(vmLineage.tasks.installPackages(["git", "gh"]))
  .add(vmLineage.tasks.installBun());
```

or:

```ts
app.sequence("database")
  .add(db.tasks.createBranch())
  .add(db.tasks.migrate("./drizzle"));
```

Provider helpers can hide provider-specific details:

- Freestyle snapshots after VM mutations.
- Neon branches and cleanup.
- Docker container/image commits.
- Daytona workspaces.
- terminal/browser interactions.

Core Rigkit should not know what a VM, snapshot, branch, or terminal is. It should
only know that task runs can produce provider-owned artifact references.

For example, a Freestyle helper sequence may present a handler with an ergonomic
`vm.exec` API while internally doing this:

1. read the upstream snapshot ref;
2. create a VM from that snapshot;
3. pass the rich VM object to the handler;
4. snapshot after the handler finishes;
5. output only a serializable VM snapshot ref.

## Interaction Boundary

`interact.terminal` should not be a core task primitive. Terminal support is a
provider capability.

Freestyle can expose a first-class terminal helper:

```ts
await terminal.open("Log in to GitHub", {
  target: vm,
  command: "gh auth login --web",
});
```

Core should expose a generic interaction API for providers. The API should let a
task/provider ask the engine to present HTML or a local URL, listen for an event
or completion signal, and resume the task after the interaction finishes.

Conceptually:

```ts
await engine.interaction.present({
  title: "Log in to GitHub",
  html,
  onEvent: async (event) => {
    if (event.type === "finished") return { done: true };
  },
});
```

The exact shape can change, but the important boundary is that rigkit owns the
hosted interaction lifecycle while providers own the interaction content and
protocol. The Freestyle terminal provider can use this to serve a browser
terminal, connect it to a VM shell, and wait for a "finished" event. Daytona,
Docker, or other providers can expose their own interaction UX without core Rigkit
knowing terminal semantics.

## Cache Model

Cache should be graph-based.

Every node run records:

- workflow name;
- node path/name;
- upstream node run IDs;
- workflow/provider fingerprint;
- JSON output;
- provider artifact references;
- invalidation status;
- optional schema/version metadata.

A run is reusable only if:

- it has not been manually invalidated;
- its upstream run IDs match the current selected upstream runs;
- the relevant provider fingerprint is compatible;
- all provider artifacts validate;
- optional output schemas still parse the cached output.

This means invalidation does not need to eagerly delete descendants for
correctness. Planning in graph order naturally makes descendants non-reusable
when their upstream run changed.

For user experience, the plan should still explain cascading effects:

```text
base-vm.install-toolchain  cached
repo.clone                 rerun    manually invalidated
repo.install               rerun    depends on repo.clone
database.branch            cached
open-workspace             rerun    depends on repo
```

## Freestyle Snapshot Semantics

Freestyle snapshots become provider artifacts attached to task runs.

```text
create-vm         -> snapshot A
install-toolchain -> snapshot B, depends on create-vm run
github-auth       -> snapshot C, depends on install-toolchain run
clone-repo        -> snapshot D, depends on github-auth run
install-deps      -> snapshot E, depends on clone-repo run
```

If `github-auth` is invalidated and reruns, it produces a new run and snapshot.
`clone-repo` and `install-deps` are no longer reusable because their cached runs
depended on the old `github-auth` run. This preserves the current Freestyle
chain behavior without baking linear suffix invalidation into core Rigkit.

Because snapshot refs are explicit outputs, a workflow can branch and keep
multiple VM lineages:

```ts
app.sequence("workers")
  .add(baseVm)
  .parallel({
    api: app.sequence("api-vm")
      .task("setup-api", async ({ ctx, freestyle }) => {
        const vm = await freestyle.vms.fromSnapshot(ctx.vm);
        await vm.exec("setup-api");
        return { vm: await vm.snapshotRef() };
      }),
    web: app.sequence("web-vm")
      .task("setup-web", async ({ ctx, freestyle }) => {
        const vm = await freestyle.vms.fromSnapshot(ctx.vm);
        await vm.exec("setup-web");
        return { vm: await vm.snapshotRef() };
      }),
  });
```

The final context contains two durable VM snapshot refs:

```ts
ctx.api.vm
ctx.web.vm
```

## Parallel Safety

Parallel branches are safe when they operate on independent resources or when
their provider artifacts can be joined.

This is safe:

```text
base VM setup
  -> parallel(repo setup on VM, Neon branch setup)
  -> open workspace
```

This is not automatically safe:

```text
base VM snapshot
  -> parallel(install Node on VM, install Postgres on VM)
  -> one VM containing both
```

There is no generic way to merge two independently mutated VM snapshots. A
provider should be able to declare mutable lineage constraints so rigkit can
serialize unsafe branches or raise a clear error unless the provider supports
merging.

## Open Questions

- Should provider fingerprints initially include all workflow providers, or only
  providers actually accessed by a task?
- Should output schemas stay optional, or should packaged reusable nodes require
  schemas for stronger cache validation?
- Do we need an explicit `needs` escape hatch for arbitrary DAGs, or should
  sequence/parallel composition be the whole public model at first?
- How should parallel output namespacing work when a branch name and an existing
  context key collide?
- What is the exact low-level provider artifact API: `addArtifact`,
  `validateArtifact`, `cleanupArtifact`, `restoreArtifact`, or something more
  specific?
- What is the exact interaction API between providers and core Rigkit for
  presenting HTML, receiving browser events, and resuming task execution?

## Design Principle

The default authoring story should be:

```text
declare providers
compose tasks with sequence and parallel
return JSON context
pass durable provider refs through context
let providers package rich runtime objects, artifacts, and interactions
```

The cache should follow the workflow shape. Users should not need to manually
write cache keys for common workflows.
