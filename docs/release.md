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
@freestyle-sh/fdev-engine
@freestyle-sh/fdev-runtime-client
@freestyle-sh/fdev
@freestyle-sh/fdev-provider-freestyle
@freestyle-sh/fdev-provider-gcloud
@freestyle-sh/fdev-cmux
@freestyle-sh/fdev-vscode
@freestyle-sh/fdev-cli
```

The release tag, package versions, and hardcoded runtime versions must match exactly:

```text
tag:                  v0.1.0
@freestyle-sh/fdev-engine: 0.1.0
@freestyle-sh/fdev-runtime-client: 0.1.0
@freestyle-sh/fdev:  0.1.0
@freestyle-sh/fdev-provider-freestyle: 0.1.0
@freestyle-sh/fdev-provider-gcloud: 0.1.0
@freestyle-sh/fdev-cmux: 0.1.0
@freestyle-sh/fdev-vscode: 0.1.0
@freestyle-sh/fdev-cli:  0.1.0
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
npx npm@latest trust github @freestyle-sh/fdev-engine --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-runtime-client --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-provider-freestyle --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-provider-gcloud --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-cmux --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-vscode --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-cli --repo freestyle-sh/fdev --file publish-npm.yml -y
```

The packages use `workspace:*` dependencies inside the repo. The workflow uses `pnpm pack` first so those workspace dependencies are converted to real package versions in the packed artifacts, then `npm publish` publishes the tarballs through Trusted Publishing.

Important bootstrap constraint: npm trusted publishers can only be configured after a package already exists on npm. The normal `publish-npm.yml` workflow skips publishing until the packages exist.

For the first publish only:

1. Create a temporary granular npm token with publish access to the `@freestyle-sh` scope.
2. Add it as a repo secret named `NPM_BOOTSTRAP_TOKEN`.
3. Run `.github/workflows/bootstrap-npm.yml` with the release tag.
4. Delete the `NPM_BOOTSTRAP_TOKEN` secret.
5. Configure trusted publishing:

```bash
npx npm@latest trust github @freestyle-sh/fdev-engine --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-runtime-client --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-provider-freestyle --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-provider-gcloud --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-cmux --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-vscode --repo freestyle-sh/fdev --file publish-npm.yml -y
npx npm@latest trust github @freestyle-sh/fdev-cli --repo freestyle-sh/fdev --file publish-npm.yml -y
```

After that, use OIDC Trusted Publishing for all later releases.

## Installer

The public installer is served by the install Worker:

```bash
curl -fsSL https://fdev.freestyle.sh/install | sh
```

The Worker uses GitHub Releases as the source of truth, serves latest-version metadata, and redirects downloads to GitHub release assets. No R2 bucket is used.

Set `GITHUB_TOKEN` as a Worker secret so metadata requests use authenticated GitHub API quota:

```bash
pnpm --filter @freestyle-sh/fdev-install-worker exec wrangler secret put GITHUB_TOKEN
```

Use a fine-grained, read-only token scoped to `freestyle-sh/fdev`.

For local development, copy `apps/install-worker/.dev.vars.example` to `apps/install-worker/.dev.vars` and set the same value there. `.dev.vars` is ignored by git.

It installs to `~/.fdev/bin/fdev` by default and adds `~/.fdev/bin` to the detected shell profile. Set `FDEV_INSTALL_DIR` to override the install location, or `FDEV_NO_MODIFY_PATH=1` to skip shell profile edits.

The repo-local `scripts/install-fdev.sh` remains a fallback for direct GitHub installs.
