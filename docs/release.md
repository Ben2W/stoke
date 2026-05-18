# Release And Package Process

Rigkit stable releases are version-branch driven. `main` is for development.
Published npm packages and CLI binaries come from immutable `v*` tags, and
those tags must point at commits reachable from a `version/x.y` branch.

`main` itself can also publish on-demand canary builds — see
[Canary Builds](#canary-builds).

## Version Branches

Each stable line has its own branch:

```text
version/0.1  -> 0.1.x
version/0.2  -> 0.2.x
version/1.0  -> 1.0.x
```

Patch releases stay on the existing line. Minor and major prepare workflows
create the new version branch automatically.

`create-release-line.yml` still exists as an escape hatch for unusual manual
branch setup, but the normal release flow should not need it.

## Feature PR Labels And Release Notes

Every PR into `main` must have exactly one release label:

```text
release:none
release:patch
release:minor
release:major
```

The `Check Release Label` workflow enforces this. Use `release:none` for docs,
tests, CI-only changes, or internal changes that should not publish packages.

Every PR not labeled `release:none` must also fill in the `## Release notes`
section of the PR description (the template prompts for this). That line is
aggregated into the next GitHub Release body.

## Preparing A Stable Release

Use the workflow that matches the release intent.

For a patch on an existing version line, run the patch workflow from that
version branch and select the single version option shown in GitHub Actions:

```bash
gh workflow run prepare-patch-release.yml --ref version/0.1 -f version=0.1.10
```

For a new minor release from `main`, select the generated next minor version:

```bash
gh workflow run prepare-minor-release.yml --ref main -f version=0.2.0
```

For a new major release from `main`, select the generated next major version:

```bash
gh workflow run prepare-major-release.yml --ref main -f version=1.0.0
```

The workflows compute the next version and target branch:

```text
patch from version/0.1 at 0.1.9 -> 0.1.10 into version/0.1
minor from main at 0.1.9        -> 0.2.0 into version/0.2
major from main at 1.7.4        -> 2.0.0 into version/2.0
```

The workflow:

1. Checks out the selected source branch.
2. Computes the next version and verifies it matches the selected version.
3. Creates the target version branch for minor and major releases.
4. Runs `pnpm release:bump <version>`, which updates package versions and constants.
5. Runs `pnpm docs:version -- --version <version>`, which snapshots the current docs into `apps/docs/v<version>` and updates the Mintlify version dropdown.
6. Runs release preflight, docs broken-link validation, typecheck, tests, and build.
7. Opens a release PR back into the target `version/x.y` branch.

`pnpm release:bump` updates the one-option workflow inputs for the next release.
Because that edits `.github/workflows/*`, prepare workflows use
`RELEASE_BOT_TOKEN` instead of the default `GITHUB_TOKEN`. The token must be
allowed to read the repo, push contents and workflow-file changes, and open PRs.
The prepare workflow checks those token permissions before creating branches or
PRs. `pnpm release:check` fails on `main` if those workflow inputs are stale.
`check-release-bot-token.yml` also validates the token on relevant main/version
pushes and can be run manually without preparing a release.

Release PRs must include the docs snapshot for the release. The release tag is
created from the merged release PR commit, so the tag points at a commit that
already contains `apps/docs/v<version>` and the corresponding `docs.json`
`navigation.versions` entry. `pnpm release:preflight` verifies this for stable
releases.

Merging that release PR runs `tag-release.yml`, which creates and pushes the
matching `v*` tag. The tag triggers:

- `.github/workflows/publish-npm.yml`
- `.github/workflows/release-cli.yml`

After both tag workflows succeed, `sync-latest-release.yml` opens a PR from the
version branch back to `main` only when that version branch is the newest
released line. For example, `version/0.2` syncs back after `v0.2.1` while
`0.2` is the newest released line. If `version/0.3` has already published,
later `version/0.2` patches do not sync back automatically.

## Canary Builds

Canary builds publish from `main` on demand. They use a non-semver-stable
version scheme and are intended for testing only — pin to a real `v*` release
for anything you ship.

Trigger from the Actions UI ("Publish npm Packages" → Run workflow) or:

```bash
gh workflow run publish-npm.yml --ref main
```

`publish-npm.yml` handles stable releases (on tag push), canary main builds
(workflow_dispatch), and PR canaries (issue_comment) — all in one file. npm
trusted publishing requires the OIDC token's `workflow_ref` claim to match the
trusted file, and only allows one trust entry per package, so everything that
publishes to npm has to live in `publish-npm.yml`. Each canary main run
publishes all npm packages with dist-tag `canary` at a version like:

```text
0.0.0-canary-20260517T154233-eb90854
```

and creates a GitHub *prerelease* on a matching tag, with CLI binaries
attached. Because the prerelease flag is set, `releases/latest` keeps pointing
at the most recent stable tag — installers and the website's stable views are
unaffected.

Install a canary CLI:

```bash
curl -fsSL https://rigkit.freestyle.sh/install/canary | sh
```

Install canary npm packages:

```bash
pnpm add @rigkit/sdk@canary
```

The website's `/canary` page shows the current canary version per package
(read from the npm registry's `dist-tags.canary` field) plus the prerelease
history from GitHub.

## Local Release Checks

Useful release scripts:

```bash
pnpm release:check
pnpm release:check-github-token
pnpm release:preflight
pnpm release:plan -- --release-type patch
pnpm release:update-workflows
pnpm release:bump patch
pnpm release:bump minor
pnpm release:bump major
pnpm release:bump 0.2.0
pnpm docs:version -- --version 0.2.0
pnpm docs:check-version -- --version 0.2.0
pnpm release:pack
pnpm release:publish -- --dry-run
pnpm release:sync-latest -- --tag v0.2.1
```

`release:check-github-token` requires `RELEASE_BOT_TOKEN` and
`GITHUB_REPOSITORY`. In GitHub Actions, the prepare workflows provide both.
Locally, use it only when validating a candidate release bot token.

The package list lives in `scripts/release/config.ts`. Add new public packages
there. `pnpm release:check` fails if a public package under `packages/*` is not
in that config.

## Versioned Docs

Mintlify deploys from the docs files and `docs.json` in the connected branch,
so Rigkit commits release docs snapshots into the repository. The editable docs
at the root of `apps/docs` are the canary docs. Stable release docs live under
`apps/docs/v<version>`.

```text
apps/docs/
  introduction.mdx          # canary
  guides/
  providers/
  v0.2.8/
    introduction.mdx        # stable snapshot
    guides/
    providers/
```

`pnpm docs:version -- --version <version>` copies the current docs into the
version directory, rewrites absolute docs links to point at that version, marks
the new version as `Latest`, keeps `canary` in the version dropdown, and removes
the previous `Latest` marker. The command fails if the snapshot already exists
unless `--force` is passed.

`pnpm docs:check-version -- --version <version>` verifies that the version
directory exists, `docs.json` has the expected Mintlify version entry, exactly
one stable version is marked `Latest`, and all versioned navigation pages exist.

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
- a tag commit is not reachable from the expected `version/x.y` branch
- package versions or version constants are not lockstep

Normal publishing never skips missing packages.

## Bootstrapping npm Packages

Use bootstrap only when a package name does not exist on npm yet. npm Trusted
Publishing can only be configured after the package exists.

Bootstrap flow:

1. Prepare and tag the release through the normal version-branch flow.
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

PR canary versions look like:

```text
0.1.10-pr.123.a1b2c3d4
```

PR canaries publish with dist-tag `pr-<number>` and never publish to `latest`.
The PR canary job lives in `publish-npm.yml` alongside stable + canary main —
all three triggers (`push: tags`, `workflow_dispatch`, `issue_comment`) feed
into the same workflow file so npm's per-workflow trust matches.

## Installer Deployment

The public installer is served by the website Worker (which also hosts the
marketing page at the root):

```bash
curl -fsSL https://rigkit.freestyle.sh/install | sh
```

The Worker uses GitHub Releases as the source of truth, serves latest-version
metadata, and redirects downloads to GitHub release assets. Normal CLI releases
do not require a Worker deployment.

Deploy the Worker only when `apps/website` changes:

```bash
pnpm --filter @rigkit/website worker:deploy
```

The installer writes the binary to `~/.rigkit/bin/rig` by default and adds
`~/.rigkit/bin` to the detected shell profile. Set `RIGKIT_INSTALL_DIR` to
override the install location, or `RIGKIT_NO_MODIFY_PATH=1` to skip shell
profile edits.

The repo-local `scripts/install-rig.sh` remains a fallback for direct GitHub
installs.
