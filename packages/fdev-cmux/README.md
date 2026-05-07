# @freestyle-sh/fdev-cmux

Small SDK for driving the local `cmux` CLI from fdev workflows.

```ts
import { createCmuxClient } from "@freestyle-sh/fdev-cmux";

const cmux = createCmuxClient();

await cmux.newWorkspace({
  name: "playground",
  command: "echo hello world",
  focus: true,
});
```

Commands are printed to stderr before execution:

```text
$ cmux new-workspace --name playground --command 'echo hello world' --focus true
```

If the workspace command fails because cmux is not running yet, the SDK runs `open -a cmux` and retries the same workspace command until cmux is ready.
