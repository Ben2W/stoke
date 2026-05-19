# Contributing to Rigkit

Thanks for taking the time to improve Rigkit. This repo contains the CLI,
runtime packages, providers, documentation, website, and examples, so small,
focused changes are easiest to review.

## Local Setup

Prerequisites:

- Bun
- pnpm 9.x
- Node.js 22 or newer

Install dependencies from the repository root:

```sh
corepack enable
pnpm install
```

Run the main checks before opening a PR:

```sh
pnpm typecheck
pnpm test
```

If your change affects package builds, run:

```sh
pnpm build
```

If your change affects docs links, run:

```sh
pnpm docs:broken-links
```

## Working on the CLI

For day-to-day CLI work, use direnv. The `examples/` directory has a shared
`.envrc` that puts an example-aware `rig` shim first on `PATH`. With direnv
enabled, plain `rig` inside an example resolves to that example's local CLI
instead of a globally installed binary.

Install direnv and enable the shell hook once:

```sh
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
exec zsh
```

Then allow the examples directory once:

```sh
cd examples
direnv allow
cd smoke
which rig
rig version
```

`which rig` should point at `examples/bin/rig`. If your shell still reports a
global install after `direnv allow`, run `rehash` and check again.

If you do not use direnv, run the example-local CLI explicitly:

```sh
pnpm --dir examples/smoke exec rig plan
pnpm --dir examples/smoke exec rig apply
```

Some examples create Freestyle VMs or use local tools such as `gcloud` or cmux.
Check the example README before running it, and never commit secrets,
provider-owned state, `.env`, or `.rigkit/`.

## Pull Requests

- Keep PRs focused on one behavior, bug fix, package, or doc change.
- Add or update tests when behavior changes.
- Update docs and examples when user-facing commands or APIs change.
- Fill in the PR template summary.
- Fill in the release notes line unless the PR is docs-only, tests-only, CI-only,
  or otherwise should not ship as a package release.

Maintainers apply one release label to each PR into `main`:

```text
release:none
release:patch
release:minor
release:major
```

Use `release:none` for docs, tests, CI-only changes, and internal changes that
do not need a package release. See [docs/release.md](docs/release.md) for the
full release process.

## Code Style

- Follow the existing package patterns before adding new abstractions.
- Keep provider-specific behavior inside provider packages.
- Keep durable workflow and workspace state as JSON-compatible data at Rigkit
  boundaries.
- Prefer typed APIs over stringly typed protocols.
- Do not commit generated build output unless a package explicitly requires it.

## Reporting Bugs

When filing an issue, include:

- Rigkit version from `rig version`.
- Operating system and shell.
- The command you ran.
- Relevant `rig.config.ts` snippets.
- Expected behavior and actual behavior.

Redact API keys, tokens, host credentials, VM identifiers, and other sensitive
project details before posting logs.
