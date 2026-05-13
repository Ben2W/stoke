# Release And Package Process

Rigkit stable releases are release-branch driven. `main` is for development.
Published npm packages and CLI binaries come from immutable `v*` tags, and
those tags must point at commits reachable from a `release/x.y` branch.

## Release Branches

Each stable line has its own branch:

```text
release/0.1  -> 0.1.x
release/0.2  -> 0.2.x
release/1.0  -> 1.0.x
```

Patch releases stay on the existing line. Minor and major releases need a new
line first.

Create a line with the manual workflow:

```bash
gh workflow run create-release-line.yml \
  -f version_line=0.2 \
  -f source_ref=main
```

## Feature PR Labels

Every PR into `main` must have exactly one release label:

```text
release:none
release:patch
release:minor
release:major
```

The `Check Release Label` workflow enforces this. Use `release:none` for docs,
tests, CI-only changes, or internal changes that should not publish packages.

## Preparing A Stable Release

Run the manual prepare workflow against the release branch:

```bash
gh workflow run prepare-release.yml \
  -f target_branch=release/0.1 \
  -f release_type=patch
```

`release_type` can be `auto`, `patch`, `minor`, or `major`. `auto` inspects
merged PR labels since the last reachable release tag and chooses the highest
release impact.

The workflow:

1. Checks out the release branch.
2. Computes the next version.
3. Runs `pnpm release:prepare`, which updates package versions and constants.
4. Runs release preflight, typecheck, tests, and build.
5. Opens a release PR back into the target `release/x.y` branch.

Merging that release PR runs `tag-release.yml`, which creates and pushes the
matching `v*` tag. The tag triggers:

- `.github/workflows/publish-npm.yml`
- `.github/workflows/release-cli.yml`

## Local Release Checks

Useful release scripts:

```bash
pnpm release:check
pnpm release:preflight
pnpm release:bump patch
pnpm release:bump minor
pnpm release:bump major
pnpm release:bump 0.2.0
pnpm release:pack
pnpm release:publish -- --dry-run
```

The package list lives in `scripts/release/config.ts`. Add new public packages
there. `pnpm release:check` fails if a public package under `packages/*` is not
in that config.

## Published Packages

The npm workflow packs and publishes packages in release-config order:

```text
@rigkit/engine
@rigkit/runtime-client
@rigkit/sdk
@rigkit/provider-freestyle
@rigkit/provider-cmux
@rigkit/provider-gcloud-cli
@rigkit/provider-vscode
@rigkit/cli
```

Workspace dependencies should stay as `workspace:*` in the repo. `pnpm pack`
converts workspace dependencies to the concrete release version inside each
packed tarball.

## npm Publishing

Normal stable publishing uses npm Trusted Publishing from `publish-npm.yml`.
It does not use `NPM_TOKEN` or `NPM_BOOTSTRAP_TOKEN`.

`pnpm release:preflight` fails if:

- package names are not bootstrapped on npm
- the target package version already exists
- a tag version does not match package versions
- a tag commit is not reachable from the expected `release/x.y` branch
- package versions or version constants are not lockstep

Normal publishing never skips missing packages.

## Bootstrapping npm Packages

Use bootstrap only when a package name does not exist on npm yet. npm Trusted
Publishing can only be configured after the package exists.

Bootstrap flow:

1. Prepare and tag the release through the normal release-branch flow.
2. Create a temporary npm granular token with publish access to the `@rigkit`
   scope and `Bypass 2FA` enabled.
3. Add it as the GitHub secret `NPM_BOOTSTRAP_TOKEN`.
4. Run:

```bash
gh workflow run bootstrap-npm.yml -f tag=v0.2.0
```

5. Configure trusted publishing for the new packages. The workflow prints the
   commands; you can also generate them locally:

```bash
pnpm release:trust-commands
```

6. Delete `NPM_BOOTSTRAP_TOKEN` and revoke the temporary npm token.

## PR Canaries

Maintainers can publish PR canaries by commenting:

```text
/rigkit canary
```

The workflow requires the commenter to have write access and only runs for
branches in this repository. The PR must have `release:patch`, `release:minor`,
or `release:major`.

Canary versions look like:

```text
0.1.10-pr.123.a1b2c3d4
```

Canaries publish with dist-tag `pr-<number>` and never publish to `latest`.
They currently use the `NPM_CANARY_TOKEN` secret.

## Installer Deployment

The public installer is served by the install Worker:

```bash
curl -fsSL https://rigkit.freestyle.sh/install | sh
```

The Worker uses GitHub Releases as the source of truth, serves latest-version
metadata, and redirects downloads to GitHub release assets. Normal CLI releases
do not require a Worker deployment.

Deploy the Worker only when `apps/install-worker` changes:

```bash
pnpm --filter @rigkit/install-worker deploy
```

The installer writes the binary to `~/.rigkit/bin/rig` by default and adds
`~/.rigkit/bin` to the detected shell profile. Set `RIGKIT_INSTALL_DIR` to
override the install location, or `RIGKIT_NO_MODIFY_PATH=1` to skip shell
profile edits.

The repo-local `scripts/install-rig.sh` remains a fallback for direct GitHub
installs.
