# @freestyle-sh/fdev

Project-local fdev authoring API and runtime daemon package.

Configs should import authoring helpers from this package:

```ts
import { env, workflow } from "@freestyle-sh/fdev";
```

Local hosts start the project daemon through the `fdev-project-runtime` binary
installed by this package.
