# Smoke Example

This example defines a single `smoke` dev machine that writes `/tmp/fdev-ready`, then runs an interactive terminal step that writes `/tmp/fdev-interactive-ready`.

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
