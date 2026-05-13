# Freestyle Website Next Example

This example builds a Freestyle-backed workflow for `freestyle-sh/freestyle-website-next`.

The workflow:

- installs Git, GitHub CLI, Bun, and build tools
- runs the GitHub CLI web login flow in the browser terminal
- clones `https://github.com/freestyle-sh/freestyle-website-next`
- runs `bun install`
- passes Freestyle VM snapshot refs through JSON workflow context
- opens the created workspace in cmux from the `open-cmux` workspace operation

Run from this directory:

```bash
pnpm rig:plan
pnpm rig:apply
pnpm rig:fork
pnpm rig:open
```

The Freestyle API key is read from `FREESTYLE_API_KEY`.
