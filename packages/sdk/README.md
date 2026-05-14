# @rigkit/sdk

Project-local rigkit authoring API and runtime daemon package.

Configs should import authoring helpers from this package:

```ts
import { env, workflow } from "@rigkit/sdk";
```

Task handlers receive `step.log(message, options)` for structured step logs. Pass `step.log` to SDKs that accept a logger callback.
Those events stream over the runtime run session and are rendered by interactive
hosts such as the `rig` terminal run timeline.
Provider VM commands can also report incremental stdout/stderr through
`ExecOptions.onOutput`; the runtime forwards those chunks over the same run
session and falls back to buffered command output when a provider cannot stream.

Local hosts start the project daemon through the `rigkit-project-runtime` binary
installed by this package.
