# Smoke Example

This example defines a single `smoke` workflow that creates a Freestyle VM, installs the Google Cloud CLI, and runs an interactive browser-terminal login task.

Run from this directory:

```bash
pnpm rig:plan
pnpm rig:apply
pnpm rig:fork
pnpm exec rig projects
pnpm exec rig ssh smoke-workspace --print
```

During `pnpm rig:apply`, `rig` opens a local browser terminal for the interactive step. When the terminal work is done, click Finished.

The Freestyle API key is read from the repo root `.env` when commands are run from the root with `-C examples/smoke`, or from this directory's environment when run directly.
