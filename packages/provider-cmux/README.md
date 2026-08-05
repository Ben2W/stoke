# @usestoke/provider-cmux

Small SDK and Stoke provider facade for driving local `cmux`.

```ts
import { createCmuxClient } from "@usestoke/provider-cmux";

const cmux = createCmuxClient();

const workspace = await cmux.newWorkspace({
  name: "playground",
  focus: true,
});
await cmux.newSurface({
  workspace: workspace.id ?? workspace.handle,
  type: "terminal",
  focus: true,
});
```

Workflow operations use raw cmux actions through the provider facade:

```ts
const workspace = await providers.cmux.ssh({
  destination: "root@devbox.example.com",
  name: "site",
});

await providers.cmux.newSurface({
  workspace: workspace.workspaceId,
  type: "browser",
  url: "http://localhost:3000",
  focus: true,
});

const terminal = await providers.cmux.newSurface({
  workspace: workspace.workspaceId,
  type: "terminal",
  focus: false,
});

await providers.cmux.send({
  workspace: workspace.workspaceId,
  surface: terminal.surfaceId,
  text: "pnpm dev\n",
});

await providers.cmux.selectWorkspace(workspace.workspaceId);
```

Local hosts can import `@usestoke/provider-cmux/host` to register the trusted
`cmux.call` handler. The Stoke CLI registers this handler automatically.
