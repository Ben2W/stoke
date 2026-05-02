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

The npm publish workflow verifies the same tag, runs checks, packs each package with pnpm, dry-runs package publishing, then publishes the tarballs to npm in dependency order:

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

npm publishing is CI-only. Do not publish regular releases from a laptop.

The npm publish workflow uses npm Trusted Publishing. It does not use an `NPM_TOKEN` secret. The workflow has:

```yaml
permissions:
  contents: read
  id-token: write
```

Each package must have a trusted publisher configured on npm:

```bash
npx npm@latest trust github @freestyle/fdev-sdk --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle/fdev-engine --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle/fdev-cli --repo freestyle-sh/fdev --file publish-npm.yml -y
```

The packages use `workspace:*` dependencies inside the repo. The workflow uses `pnpm pack` first so those workspace dependencies are converted to real package versions in the packed artifacts, then `npm publish` publishes the tarballs through Trusted Publishing.

Important bootstrap constraint: npm trusted publishers can only be configured after a package already exists on npm. The normal `publish-npm.yml` workflow skips publishing until the packages exist.

For the first publish only:

1. Create a temporary granular npm token with publish access to the `@freestyle` scope.
2. Add it as a repo secret named `NPM_BOOTSTRAP_TOKEN`.
3. Run `.github/workflows/bootstrap-npm.yml` with the release tag.
4. Delete the `NPM_BOOTSTRAP_TOKEN` secret.
5. Configure trusted publishing:

```bash
npx npm@latest trust github @freestyle/fdev-sdk --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle/fdev-engine --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle/fdev-cli --repo freestyle-sh/fdev --file publish-npm.yml -y
```

After that, use OIDC Trusted Publishing for all later releases.

## Installer

The installer downloads from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/freestyle-sh/fdev/main/scripts/install-fdev.sh | sh
```

It installs to `~/.fdev/bin/fdev` by default and adds `~/.fdev/bin` to the detected shell profile. Set `FDEV_INSTALL_DIR` to override the install location, or `FDEV_NO_MODIFY_PATH=1` to skip shell profile edits.

`freestyle.sh/fdev/install` can later proxy, redirect, or serve a pinned copy of that script.
