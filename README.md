# Stoke

Stoke manages typed development workflows and runs them locally or in Vercel
Sandbox.

## Try it

1. Open [usestoke.dev](https://usestoke.dev) and sign in with GitHub.
2. Add the public example project:
   [github.com/Ben2W/stoke-example](https://github.com/Ben2W/stoke-example).
3. Select the project, then create a workspace.
4. Run the workspace operations from the dashboard.

Use the public example above for the demo—not this source repository.

## Why it's interesting

The [Ben2W/stoke-example](https://github.com/Ben2W/stoke-example) project has a
Stoke configuration at
[`stoke/index.ts`](https://github.com/Ben2W/stoke-example/blob/main/stoke/index.ts).

This configuration defines the project's development, agent, and CI/CD
environments.

## CLI

The CLI controls the same projects, workflows, and Vercel Sandbox workspaces
from your terminal or an agent. To try the full workflow with the public
example:

```bash
git clone https://github.com/Ben2W/stoke-example.git
cd stoke-example
npm install

stoke login
stoke add .
stoke plan stoke-example
stoke create demo stoke-example
stoke run demo ssh
stoke rm demo
```

`login` connects the terminal to Stoke, `add` links and selects the project,
`plan` previews the workflow, `create` starts a Vercel Sandbox workspace, `run`
executes an operation in that workspace, and `rm` removes it.
