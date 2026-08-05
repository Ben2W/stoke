# @usestoke/cli

The Stoke command-line application for managed development environments.

## Install

The CLI requires [Bun](https://bun.sh). Install Bun first if needed, then install Stoke globally and sign in:

```bash
bun add --global @usestoke/cli
stoke login
```

## Usage

```bash
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
