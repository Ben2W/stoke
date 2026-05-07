# Smoke Example

This example defines a single `smoke` workflow that creates a Freestyle VM, installs the Google Cloud CLI, and runs an interactive browser-terminal login task.

Run from this directory:

```bash
pnpm fdev:plan
pnpm fdev:apply
pnpm fdev:fork
pnpm exec fdev ls
pnpm exec fdev ssh smoke-workspace --print
```

During `pnpm fdev:apply`, `fdev` opens a local browser terminal for the interactive step. When the terminal work is done, click Finished.

The Freestyle API key is read from the repo root `.env` when commands are run from the root with `-C examples/smoke`, or from this directory's environment when run directly.
