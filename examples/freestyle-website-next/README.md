# Freestyle Website Next Example

This example builds a Freestyle-backed workflow for `freestyle-sh/freestyle-website-next`.

The workflow:

- installs Git, GitHub CLI, Bun, and build tools
- installs Codex CLI
- runs the GitHub login flow in a browser terminal
- configures Git commit author identity from the authenticated GitHub account
- clones `https://github.com/freestyle-sh/freestyle-website-next`
- runs `bun install`
- initializes Codex CLI from inside the cloned repo so its workspace trust and login prompts apply to the project folder
- passes Freestyle VM snapshot refs through JSON workflow context
- opens the created workspace in cmux with localhost and Codex in separate tabs
- opens the created workspace in VS Code from the `open-vscode` workspace operation

Run from this directory:

```bash
rig plan
rig apply
rig create --name website-workspace
rig run website-workspace open-cmux
rig run website-workspace open-vscode
```

Freestyle auth is handled by the provider. By default Rigkit opens the Freestyle browser login.
