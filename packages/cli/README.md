# @rigkit/cli

Global `rig` CLI.

```bash
npm i -g @rigkit/cli
rig init
rig plan
rig ls
rig --chdir=examples/smoke plan
```

`rig init` creates `rigkit/index.ts` and package metadata in the current directory, then prompts for bun, pnpm, or npm to install the local Rigkit dependencies. Use `rig init --package-manager skip` or `rig init --no-install` to write files without installing.

Interactive terminals use Inquirer prompts and a chalk/log-update run timeline. Set `RIGKIT_RENDER=0` to force the plain text renderer; `--json` and flag-driven flows remain suitable for agents and scripts.

Interactive providers can ask the CLI to open provider-owned URLs. For example, Freestyle terminal sessions are served by the Freestyle provider, while the CLI only opens the presented URL in a browser.

Workspace lifecycle commands are built in: `rig create <workspace>` creates a
workspace and `rig rm <workspace>` removes one. Workspace-specific operations
defined by the project run as `rig run <workspace> <operation>`, for example
`rig run website-workspace open-cmux`.

`rig ls` lists workspaces for the selected project. `rig ls snapshots` lists cached snapshot runs, and `rig ls config` shows the resolved project paths.

Use global context options before the command to select another project:

```bash
rig --chdir=examples/smoke plan
rig --chdir=examples/global-fragments apply --workflow api
```

Initialized projects pin matching Rigkit package versions locally.
