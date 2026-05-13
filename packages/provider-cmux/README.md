# @rigkit/provider-cmux

Small SDK and Rigkit provider facade for opening workspaces in local `cmux`.

```ts
import { createCmuxClient } from "@rigkit/provider-cmux";

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

`cmux new-workspace` and `cmux ssh` are socket commands. With cmux's default socket control mode (`cmuxOnly`), run rigkit from a terminal inside cmux so cmux sets `CMUX_SOCKET_PATH` and accepts the process.

If you intentionally enable external socket control in cmux, opt in explicitly:

```ts
const cmux = createCmuxClient({ allowExternalAutomation: true });
```

With `allowExternalAutomation`, the SDK can run `open -a cmux` and retry a workspace command while cmux starts.

Config-defined operations can request the typed `cmux.open` host capability through the provider facade:

```ts
import { workflow } from "@rigkit/sdk";
import { cmux } from "@rigkit/provider-cmux";

export default workflow("site", {
  providers: {
    cmux: cmux.provider(),
  },
})
  .sequence("site")
  .operation("open", {
    requiredHostCapabilities: [cmux.capabilities.open],
    run: async ({ providers }) => {
      await providers.cmux.open({
        name: "site",
        ssh: {
          host: "vm-ssh.freestyle.sh",
          username: "vm_123",
          auth: { type: "token", token: "token_123" },
        },
        cwd: "/workspace/site",
        command: "pnpm dev",
        url: "http://localhost:3000",
      });
    },
  });
```

Local hosts can import `@rigkit/provider-cmux/host` to register the trusted `cmux.open` handler. The Rigkit CLI registers this handler automatically.
