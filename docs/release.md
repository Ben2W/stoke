# Release Process

`fdev` uses Git tags as the release pointer. A release tag points at the exact commit that should become a GitHub Release.

## Current Policy

For v0, releases are explicit:

```bash
git checkout main
git pull
pnpm release:check

git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag runs:

- `.github/workflows/release-cli.yml`
- `.github/workflows/publish-npm.yml`

The CLI release workflow verifies that the tag matches the package version, runs checks, builds the Bun-compiled CLI binaries, and creates the GitHub Release assets.

The npm publish workflow verifies the same tag, runs checks, dry-runs package publishing, then publishes the packages to npm in dependency order:

```text
@freestyle/fdev-sdk
@freestyle/fdev-engine
@freestyle/fdev-cli
```

The release tag, package versions, and hardcoded runtime versions must match exactly:

```text
tag:                  v0.1.0
@freestyle/fdev-sdk:  0.1.0
@freestyle/fdev-engine: 0.1.0
@freestyle/fdev-cli:  0.1.0
```

## Branches vs Tags

Branches are where development happens. Tags are the immutable release markers.

For now, release from `main` by tagging a known-good commit. A separate release branch is only needed once we want to maintain older release lines while `main` moves ahead.

Example later maintenance flow:

```text
main          future 0.2.x work
release/0.1  0.1.x hotfixes
v0.1.1        tag on a release/0.1 commit
```

Even in that model, the published release still comes from a tag.

## Manual Dispatch

The GitHub release workflow also supports manual `workflow_dispatch`. That path derives the tag from `packages/fdev-cli/package.json`.

Use tag pushes for normal releases. Manual dispatch is mainly a convenience for rerunning the current package version from GitHub Actions.

## npm Publishing

npm publishing is CI-only. Do not publish from a laptop.

The GitHub repo must have an `NPM_TOKEN` secret with permission to publish:

```text
@freestyle/fdev-sdk
@freestyle/fdev-engine
@freestyle/fdev-cli
```

Use an npm automation or granular access token for the `@freestyle` scope. The packages are public scoped packages, so the workflow publishes with `--access public`.

The packages use `workspace:*` dependencies inside the repo. Publishing uses `pnpm publish` so those workspace dependencies are converted to real package versions in the packed artifacts.

## Installer

The installer downloads from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/freestyle-sh/fdev/main/scripts/install-fdev.sh | sh
```

It installs to `~/.fdev/bin/fdev` by default and adds `~/.fdev/bin` to the detected shell profile. Set `FDEV_INSTALL_DIR` to override the install location, or `FDEV_NO_MODIFY_PATH=1` to skip shell profile edits.

`freestyle.sh/fdev/install` can later proxy, redirect, or serve a pinned copy of that script.
