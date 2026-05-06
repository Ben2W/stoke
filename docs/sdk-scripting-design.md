# SDK Scripting Design

The SDK models a remote dev machine as an ordered chain of stateful steps over a base VM image.

```text
base image
  -> step 1
  -> snapshot
  -> step 2
  -> snapshot
  -> step N
  -> snapshot
  -> forkable workspace
```

The authoring API is intentionally small:

```ts
defineDevMachine({ name, provider, image, steps })
defineStep(name, fn)
defineStep(name, { dependsOn: [otherStep] }, fn)
```

Steps install tools, configure repos, validate auth, write files, and publish typed context for later steps.
There is no separate package spec layer and no `step.assert` helper. A step runs commands and throws when its own readiness check fails.

## Step Example

```ts
import { defineDevMachine, defineStep, env } from "@freestyle-sh/fdev-sdk";
import { defineFreestyleProvider } from "@freestyle-sh/fdev-provider-freestyle";

const gcloudStep = defineStep("install gcloud cli", async ({ vm }) => {
  await vm.exec("sudo apt-get update && sudo apt-get install -y google-cloud-cli", {
    name: "install gcloud cli",
  });

  const version = await vm.probe("gcloud --version", {
    name: "verify gcloud cli",
  });

  if (!version.ok) {
    throw new Error(`gcloud is not installed: ${version.stderr}`);
  }

  return { ctx: { gcloudVersion: version.stdout.trim() } };
});

const verifyNode = defineStep(
  "install and verify node 24",
  { dependsOn: [gcloudStep] },
  async ({ vm, ctx }) => {
    const cloudVersion = ctx.get("gcloudVersion");

    await vm.exec(
      "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y nodejs",
      { name: "install node 24" },
    );

    const version = await vm.probe("node --version", {
      name: "verify node version",
    });

    if (!version.ok || !version.stdout.trim().startsWith("v24.")) {
      throw new Error(
        `Node.js is not installed or not version 24. Output: ${version.stdout} Error: ${version.stderr}`,
      );
    }

    return {
      ctx: {
        nodeVersion: version.stdout.trim(),
        installedAfterGcloud: cloudVersion ?? "unknown",
      },
    };
  },
);

export default defineDevMachine({
  name: "platform",
  provider: defineFreestyleProvider({
    apiKey: () => env("FREESTYLE_API_KEY"),
  }),
  image: "ubuntu-24.04",
  steps: [gcloudStep, verifyNode],
});
```

## Dependency Rules

`dependsOn` exists for two purposes:

- TypeScript uses dependency output context to type `ctx.get(...)` and `ctx.require(...)`.
- `defineDevMachine` validates that dependencies are included before the dependent step.

For static `steps` arrays, dependency errors are raised during `defineDevMachine`. For dynamic `steps: ({ options }) => [...]`, the engine validates the resolved array when loading the machine.

Dependencies are exact step instances. If a step is parameterized, put the same instantiated step in both the dependency list and the machine step list.

## Runtime Context

Each step receives low-level primitives:

```ts
type StepRuntimeContext<Input = void, Context = {}> = {
  input: Input;
  vm: VmInspector;
  interact: InteractionRunner;
  snapshot: SnapshotController;
  ctx: StepContextStore<Context>;
};
```

`vm.exec(command, { name, cwd, env, timeoutMs })` returns `{ stdout, stderr, exitCode, ok }` when the command succeeds and throws when `ok` is false.
`vm.probe(command, { name, cwd, env, timeoutMs })` always returns `{ stdout, stderr, exitCode, ok }`, so the step handler can branch on the current machine state.

Steps can pass context forward in either of these forms:

```ts
return { ctx: { nodeVersion: "v24.0.0" } };
ctx.set("nodeVersion", "v24.0.0");
```

Returning context is preferred because it gives dependent steps better static types.

## Caching

The engine snapshots after each successful top-level step. A machine chain key includes:

- machine name and base image/resources
- ordered step names
- serialized step inputs

When applying a machine, the engine finds the latest cached prefix and only runs the missing suffix. Changing, removing, or reordering a step invalidates that step and every later step.

## Provider Boundary

`provider` authenticates and configures the backing VM provider. The Freestyle provider package implements the base fdev contract: create, snapshot, exec, SSH, file read/write, and delete. Provider credentials are not automatically copied into the remote VM. If a credential should exist inside the machine, a step must explicitly place it there.

## CLI

The CLI loads `fdev.config.ts`, validates the step chain, prints plans, applies missing steps, snapshots results, and forks workspaces from the latest resolved snapshot.

```bash
fdev plan
fdev apply
fdev fork --name my-workspace
fdev ls
fdev ssh my-workspace
```
