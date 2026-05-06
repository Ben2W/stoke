# Freestyle Website Next Example

This example builds a Freestyle VM for `freestyle-sh/freestyle-website-next`.

The machine:

- installs Git, GitHub CLI, Bun, and build tools
- runs the GitHub CLI web login flow in the browser terminal
- clones `https://github.com/freestyle-sh/freestyle-website-next`
- runs `bun install`
- writes a VS Code folder-open task that starts `bun dev --host 0.0.0.0 --port 4321`
- opens the forked workspace in VS Code Remote-SSH from `workspace.onCreated`

Run from this directory:

```bash
pnpm fdev:plan
pnpm fdev:apply
pnpm fdev:fork
```

The Freestyle API key is read from `FREESTYLE_API_KEY`.

VS Code may prompt to allow automatic folder tasks the first time it opens the repository. Allow it if you want the dev server terminal to start automatically.

Set `FDEV_PREINSTALL_VSCODE_SERVER=1` before `pnpm fdev:apply` to attempt a best-effort VS Code Remote-SSH server cache during setup.
