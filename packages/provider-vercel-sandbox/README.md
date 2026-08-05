# @usestoke/provider-vercel-sandbox

Managed Vercel Sandbox provider for Stoke.

```ts
import { vercelSandbox } from "@usestoke/provider-vercel-sandbox";
import { workflow } from "@usestoke/sdk";

const app = workflow("website");
const sandbox = vercelSandbox.provider();

export const website = app
  .sequence("website")
  .addProvider("vercel", sandbox)
  .task("prepare", async ({ providers }) => {
    const vm = await providers.vercel.client.create({
      runtime: "node24",
      timeout: 300_000,
    });
    return { ctx: { sandbox: vm.name } };
  });
```

The provider always calls Stoke's authenticated control plane. The control
plane owns the Vercel project and OIDC identity; workflow code never receives
Vercel credentials and does not need a locally linked Vercel project.

Interactive access is deliberately a separate provider so operation capability
requirements remain scoped:

```ts
.addProvider("terminal", vercelSandbox.terminal())
.workspaceOperation("ssh", {
  run: async ({ providers, workspace }) =>
    await providers.terminal.open({
      sandbox: workspace.ctx.sandbox,
      title: `SSH ${workspace.name}`,
    }),
})
```

The runtime sends a typed `ssh` capability request. Stoke obtains a short-lived
interactive session from its control plane and bridges that session to the
local terminal; remote workflow code is never evaluated on the developer
machine.
