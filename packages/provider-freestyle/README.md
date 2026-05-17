# @rigkit/provider-freestyle

Freestyle provider integration for `rig`.

This package supplies:

- `freestyle.provider(...)` for host Freestyle authentication
- `freestyle.terminal()` for provider-owned browser terminal sessions targeting Freestyle VMs
- `providers.freestyle.client` for direct access to the authenticated Freestyle SDK client
- `providers.freestyle.createSSHOptions(...)` for VM SSH connection options with provider-owned auth handled internally
- `providers.freestyle.cmux.createSshOptions(...)` and `providers.freestyle.vscode.createUrl(...)` adapter helpers
- Freestyle SDK exports like `VmSpec` and `VmBaseImage`, so configs use one SDK instance for specs and clients
- Freestyle-specific JSON state helpers backed by Rigkit provider storage

Pass Rigkit's `step.log` to Freestyle SDK calls that accept `logger` to stream SDK progress into the CLI.

By default the provider authenticates through a browser login and stores Freestyle credentials in Rigkit's provider host storage, outside project `.rigkit/state.sqlite`. Pass `freestyle.provider({ apiKey })` or `freestyle.provider(apiKey)` to use API-key auth instead.
