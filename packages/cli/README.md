# @usestoke/cli

The private Stoke command-line application.

```bash
stoke login
stoke add owner/repository
stoke use my-project
stoke plan
stoke apply
stoke ls
```

`stoke init` writes the project workflow entrypoint and installs the matching
`@usestoke/sdk` and `@usestoke/provider-vercel-sandbox` versions. The starter creates
Vercel Sandbox workspaces and exposes a typed `ssh` operation.

The CLI evaluates TypeScript project workflows, synchronizes state with the
managed control plane, renders run events, and executes explicitly registered
host capabilities such as cmux and Vercel Sandbox SSH.
