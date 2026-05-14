# @rigkit/cli

Global `rig` CLI.

```bash
npm i -g @rigkit/cli
rig init
rig run plan
rig ls
rig run plan github:owner/repo
```

`rig init` asks for a project name, Freestyle API key, and package manager. It creates a project folder containing a workflow-based `rig.config.ts`, `.env`, `.env.example`, `package.json`, and local ignore rules.

Interactive terminals use Inquirer prompts and a chalk/log-update run timeline. Set `RIGKIT_RENDER=0` to force the plain text renderer; `--json` and flag-driven flows remain suitable for agents and scripts.

Interactive providers can ask the CLI to open provider-owned URLs. For example, Freestyle terminal sessions are served by the Freestyle provider, while the CLI only opens the presented URL in a browser.

Workspace-specific operations run as `rig run <workspace>/<operation>`, for example `rig run website-workspace/open-cmux` or `rig run website-workspace/remove -y`.

`rig ls` lists workspaces for the selected project. `rig ls snapshots` lists cached snapshot runs, and `rig ls config` shows the resolved project paths.

Remote GitHub targets are materialized into `~/.rigkit/projects`, use state outside the checkout, and require explicit trust before installing dependencies or executing the remote config.

Projects should install matching `@rigkit/sdk` versions locally.
