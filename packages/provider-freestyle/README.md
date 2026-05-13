# @rigkit/provider-freestyle

Freestyle provider integration for `rig`.

This package supplies:

- `freestyle.provider(...)` for Freestyle VM/snapshot workflow tasks
- `freestyle.terminal()` for provider-owned browser terminal sessions targeting Freestyle VMs
- `providers.freestyle.client` for direct access to the authenticated Freestyle SDK client
- `providers.freestyle.cmux.createSshOptions(...)` and `providers.freestyle.vscode.createUrl(...)` adapter helpers
- `createFreestyleProvider(...)` for low-level Freestyle VM operations
- Freestyle-specific JSON state helpers backed by Rigkit provider storage

By default the provider authenticates through a browser login and stores Freestyle credentials in Rigkit's provider host storage, outside project `.rigkit/state.sqlite`. Pass `auth: { apiKey }` to use API-key auth instead.
