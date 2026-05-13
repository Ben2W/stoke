# @rigkit/provider-freestyle

Freestyle provider integration for `rig`.

This package supplies:

- `freestyle.provider(...)` for Freestyle VM/snapshot workflow tasks
- `freestyle.terminal()` for provider-owned browser terminal sessions targeting Freestyle VMs
- `providers.freestyle.cmux.createSshOptions(...)` and `providers.freestyle.vscode.createUrl(...)` adapter helpers
- `createFreestyleProvider(...)` for low-level Freestyle VM operations
- Freestyle-specific JSON state helpers backed by the Rigkit-owned provider storage table
