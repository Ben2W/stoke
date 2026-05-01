# Smoke Example

This example defines a single `smoke` dev machine that writes and verifies `/tmp/fdev-ready`.

Run from this directory:

```bash
pnpm plan
pnpm apply
pnpm fork
pnpm exec fdev terminal smoke-workspace --print
```

The Freestyle API key is read from the repo root `.env` when commands are run from the root with `--project`, or from this directory's environment when run directly.
