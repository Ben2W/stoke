# @freestyle-sh/fdev

Project-local fdev authoring API and runtime daemon package.

Configs should import authoring helpers from this package:

```ts
import { env, workflow } from "@freestyle-sh/fdev";
```

Task handlers receive `runtime.log(message, options)` for structured step logs.
Those events stream over the runtime run session and are rendered by interactive
hosts such as the `fdev` terminal run timeline.
Provider VM commands can also report incremental stdout/stderr through
`ExecOptions.onOutput`; the runtime forwards those chunks over the same run
session and falls back to buffered command output when a provider cannot stream.

Local hosts start the project daemon through the `fdev-project-runtime` binary
installed by this package.
