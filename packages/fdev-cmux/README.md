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

`cmux new-workspace` and `cmux ssh` are socket commands. With cmux's default socket control mode (`cmuxOnly`), run fdev from a terminal inside cmux so cmux sets `CMUX_SOCKET_PATH` and accepts the process.

If you intentionally enable external socket control in cmux, opt in explicitly:

```ts
const cmux = createCmuxClient({ allowExternalAutomation: true });
```

With `allowExternalAutomation`, the SDK can run `open -a cmux` and retry a workspace command while cmux starts.
