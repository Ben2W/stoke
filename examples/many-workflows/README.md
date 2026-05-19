# Many Workflows Example

This example shows a larger `rigkit/index.ts` layout with several first-class
workflows. It is intentionally provider-free so the structure is easy to read
and fast to typecheck.

The project has four workflows:

- `api`: prepares an API service workspace.
- `web`: prepares a frontend workspace.
- `worker`: prepares a background worker workspace.
- `docs`: prepares a docs workspace.

The entrypoint exports a `workflows` object:

```ts
export const workflows = {
  api,
  web,
  worker,
  docs,
};
```

Run from this directory:

```bash
rig ls
rig plan --workflow api
rig apply --workflow api
rig create --workflow api api-dev
rig run api-dev status
rig run api-dev dev
rig run api-dev test --pattern auth
rig run api-dev release-notes --release 1.4.0 --channel canary
```

Use `rig ls` after creating workspaces to see the workflow-grouped rendering.

## Layout

```text
rigkit/
  index.ts
  workflows/
    api.ts
    docs.ts
    web.ts
    worker.ts
  shared/
    catalog.ts
    service-workflow.ts
    toolchain.ts
```

`shared/catalog.ts` keeps service metadata declarative. `shared/toolchain.ts`
contains global setup reused by every workflow. `shared/service-workflow.ts`
turns a service definition into a complete workflow with setup tasks, workspace
lifecycle, and workspace operations.
