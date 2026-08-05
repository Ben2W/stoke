# @rigkit/provider-freestyle

Freestyle provider integration for `rig`.

This package supplies:

- `freestyle.provider(...)` for host Freestyle authentication
- `freestyle.terminal()` for provider-owned browser terminal sessions targeting Freestyle VMs
- `providers.freestyle.client` for direct access to the authenticated Freestyle SDK client
- `providers.freestyle.createSSHOptions(...)` for VM SSH connection options with provider-owned auth handled internally
- `providers.freestyle.cmux.createSshOptions(...)` and `providers.freestyle.vscode.createUrl(...)` adapter helpers
- Freestyle-specific JSON state helpers backed by Rigkit provider storage

Use `vm.exec(...)` inside workflow tasks to install VM dependencies before taking a snapshot. Pass `console.log` to Freestyle SDK calls that accept `logger` to stream SDK progress into the CLI. Console output inside a task handler is intercepted by the Rigkit runtime and emitted as leveled `log.output` events.

By default the provider authenticates through a browser login and stores Freestyle credentials in provider-owned host storage, outside Stoke's managed project state. Pass `freestyle.provider({ apiKey })` or `freestyle.provider(apiKey)` to use API-key auth instead.
