# @freestyle-sh/fdev-cli

Global `fdev` CLI.

```bash
npm i -g @freestyle-sh/fdev-cli
fdev init
fdev run plan
fdev ls
fdev run plan github:owner/repo
```

`fdev init` asks for a project name, Freestyle API key, and package manager. It creates a project folder containing a workflow-based `fdev.config.ts`, `.env`, `.env.example`, `package.json`, and local ignore rules.

Interactive terminals use Inquirer prompts and a chalk/log-update run timeline. Set `FDEV_RENDER=0` to force the plain text renderer; `--json` and flag-driven flows remain suitable for agents and scripts.

Interactive providers can ask the CLI to open provider-owned URLs. For example, Freestyle terminal sessions are served by the Freestyle provider, while the CLI only opens the presented URL in a browser.

`fdev run ssh <workspace>` runs the workflow's uncached `workspace.onOpen` hook before attaching or printing the SSH command.

`fdev ls` lists workspaces for the selected project. `fdev ls snapshots` lists cached snapshot runs, and `fdev ls config` shows the resolved project paths.

Remote GitHub targets are materialized into `~/.fdev/projects`, use state outside the checkout, and require explicit trust before installing dependencies or executing the remote config.

Projects should install matching `@freestyle-sh/fdev` versions locally.
