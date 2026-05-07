# @freestyle-sh/fdev-cli

Global `fdev` CLI.

```bash
npm i -g @freestyle-sh/fdev-cli
fdev init
fdev plan
```

`fdev init` asks for a project name, Freestyle API key, and package manager. It creates a project folder containing a workflow-based `fdev.config.ts`, `.env`, `.env.example`, `package.json`, and local ignore rules.

Interactive providers can ask the CLI to open provider-owned URLs. For example, Freestyle terminal sessions are served by the Freestyle provider, while the CLI only opens the presented URL in a browser.

Projects should install matching `@freestyle-sh/fdev-sdk` versions locally.
