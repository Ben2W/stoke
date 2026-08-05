# @stoke/provider-vercel-sandbox

Stoke provider for the official `@vercel/sandbox` SDK.

```ts
import { vercelSandbox } from "@stoke/provider-vercel-sandbox";
import { workflow } from "@stoke/sdk";

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

The SDK uses Vercel OIDC or the standard Vercel environment variables by
default. Explicit `token`, `projectId`, and `teamId` values must be supplied
together.

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

The runtime sends a typed `ssh` capability request. Stoke CLI executes the
locally installed host handler using `vercel sandbox connect`; remote code is
never evaluated on the developer machine.
