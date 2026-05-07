# cmux Playground Example

Minimal fdev workflow for testing local cmux integration.

On every `fdev fork`, the workspace `onCreated` hook creates a local cmux workspace and runs:

```bash
echo hello world
```

Run from this directory:

```bash
pnpm fdev:plan
pnpm fdev:apply
pnpm fdev:fork
```

The Freestyle API key is read from `FREESTYLE_API_KEY`. The local `cmux` CLI/app must be installed.
