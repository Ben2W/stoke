# Freestyle Website Next Example

This example builds a Freestyle-backed workflow for `freestyle-sh/freestyle-website-next`.

The workflow:

- installs Git, GitHub CLI, Bun, and build tools
- preinstalls the VS Code Remote-SSH server
- runs the GitHub CLI web login flow in the browser terminal
- clones `https://github.com/freestyle-sh/freestyle-website-next`
- runs `bun install`
- writes a VS Code folder-open task that starts `bun dev --host 0.0.0.0 --port 4321`
- passes Freestyle VM snapshot refs through JSON workflow context
- opens the forked workspace in VS Code Remote-SSH from `workspace.onCreated`

Run from this directory:

```bash
pnpm rig:plan
pnpm rig:apply
pnpm rig:fork
```

The Freestyle API key is read from `FREESTYLE_API_KEY`.

VS Code may prompt to allow automatic folder tasks the first time it opens the repository. Allow it if you want the dev server terminal to start automatically.
