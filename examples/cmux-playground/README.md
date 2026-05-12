# cmux Playground Example

Minimal fdev workflow for testing local cmux integration.

On every `fdev run create`, the workspace `onCreated` hook asks the local fdev host to create a cmux workspace and run:

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

cmux socket commands are routed through the fdev host capability registered by the CLI. That keeps the socket call in the terminal process that ran `fdev`, instead of in fdev's detached project runtime, which may have been started before the current cmux terminal environment existed.
