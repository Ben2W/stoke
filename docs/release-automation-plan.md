# Release Automation Plan

This is the release system for Rigkit. The goal is to make stable releases
reviewable, repeatable, and branch-aware while keeping normal feature work on
`main`.

## Goals

- Keep `main` as the development branch.
- Release stable versions only from `release/x.y` branches.
- Make old release lines patchable.
- Keep public packages lockstep versioned.
- Make missing npm bootstrap or trusted publishing state fail loudly.
- Automate version bumps and release PR creation.
- Support PR canary packages with `/rigkit canary`.

## Branch Model

`main` is development only. Stable releases never publish directly from `main`.

Stable releases come from release-line branches:

```text
main              development
release/0.1       0.1.x stable releases
release/0.2       0.2.x stable releases
release/1.0       1.0.x stable releases
```

This allows patch releases on old lines:

```text
release/0.1 -> v0.1.10, v0.1.11
release/0.2 -> v0.2.0, v0.2.1
release/1.0 -> v1.0.0, v1.0.1
```

## Release Labels

Every feature PR into `main` should have exactly one release label:

```text
release:none
release:patch
release:minor
release:major
```

Label meanings:

- `release:none`: no published package release.
- `release:patch`: bug fix or safe maintenance.
- `release:minor`: additive, non-breaking feature.
- `release:major`: breaking API, CLI, config, runtime protocol, package layout, or install behavior.

For mixed changes, the highest-impact label wins:

```text
major > minor > patch > none
```

## Release Config

`scripts/release/config.ts` is the single source of truth for publishable
package metadata.

It defines:

- public package names
- package directories
- version constant files and constant names
- publish order
- SDK runtime version file
- CLI package and binary metadata

All release scripts and workflows read from this config instead of duplicating
package arrays.

## Release Scripts

Root scripts:

```bash
pnpm release:check
pnpm release:check-github-token
pnpm release:preflight
pnpm release:bump patch
pnpm release:bump minor
pnpm release:bump major
pnpm release:bump 0.2.0
pnpm release:update-workflows
pnpm release:pack
pnpm release:publish -- --dry-run
pnpm release:trust-commands
```

`release:check` should verify:

- public packages are listed in release config
- package names and directories match config
- publishable package versions are lockstep
- version constants match package versions
- prepare workflow version choices match the current package version
- workflows do not duplicate package publish lists

`release:preflight` should verify:

- `release:check` passes
- tag and package version match when running from a tag
- tag commit is reachable from a `release/*` branch
- package version matches the release branch line
- npm package names exist for normal stable publish
- target package versions are not already published

Trusted publishing is ultimately verified by the npm dry-run/publish steps.
Bootstrap prints the npm trust commands for any new package names.

Missing npm packages should fail with explicit bootstrap instructions. Normal
publishing should never silently skip.

`release:bump` should update:

- public package `package.json` versions
- all version constants
- `packages/sdk/src/runtime/version.ts`
- version assertions in tests
- prepare workflow version choices
- release docs examples when appropriate
- lockfile, if needed

`release:pack` should pack packages in release-config order.

## Create Release Line Workflow

Manual GitHub Action:

```text
Create Release Line
inputs:
  version_line: 0.2
  source_ref: main
```

It creates:

```text
release/0.2
```

from the selected source ref.

## Prepare Release Workflow

Manual GitHub Actions:

```text
Prepare Patch Release
Prepare Minor Release
Prepare Major Release
```

Behavior:

1. Check out the selected source branch.
2. Compute the next version and verify it matches the selected workflow option.
3. Create the target release branch for minor and major releases.
4. Run `pnpm release:bump <computed-version>`.
5. Generate the release PR body.
6. Commit changes to a bot branch:

   ```text
   automation/release-v0.1.10-<run-id>
   ```

7. Open a PR into:

   ```text
   release/0.1
   ```

Patch releases must run from the existing release branch. Minor and major
releases must run from `main` and create the new release branch automatically.
Each user-facing prepare workflow has one version choice, generated from the
package version on `main`. Release preparation edits workflow files, so it uses
`RELEASE_BOT_TOKEN` instead of the default `GITHUB_TOKEN`. The prepare workflow
checks that token for repository access, contents write, workflows write, and
pull requests write before creating branches or PRs. `Check Release Bot Token`
also validates the secret on relevant main/release pushes and manual runs.

## Version Rules

Release branches constrain allowed versions:

- `release/0.1` may publish only `0.1.x`
- `release/0.2` may publish only `0.2.x`
- `release/1.0` may publish only `1.0.x`

Patch releases stay on the same release line:

```text
release/0.1 -> 0.1.10
```

New minor or major releases require a new release branch:

```text
release/0.2 -> 0.2.0
release/1.0 -> 1.0.0
```

## Publish Flow

On merge of a release PR into `release/x.y`:

1. Run `pnpm release:preflight`.
2. Create a tag for the release:

   ```text
   v0.1.10
   ```

3. Push the tag.

Tag push then triggers:

- npm package publishing
- CLI binary build and GitHub Release asset publishing

After both tag workflows succeed, a sync workflow should open a PR from the
release branch back to `main` only when that release branch is the latest
released line. Older maintained release lines should not sync back
automatically.

## npm Publish Workflow

Rewrite `publish-npm.yml` to be script-driven:

1. Install dependencies.
2. Run `pnpm release:preflight`.
3. Pack packages in release-config order.
4. Dry-run publish.
5. Publish through npm trusted publishing.

Important behavior:

- only run for `v*` tags
- require tag commits to be reachable from `release/*`
- fail if npm package names are missing
- fail if target version already exists
- do not use skip-on-missing package behavior

## CLI Release Workflow

Rewrite `release-cli.yml` to be script-driven:

1. Install dependencies.
2. Run `pnpm release:preflight`.
3. Build CLI binaries.
4. Smoke test the Linux binary.
5. Create the GitHub Release and upload assets.

It should only run for `v*` tags whose commits are reachable from `release/*`.

## Sync Latest Release Back To Main

Manual or workflow-triggered GitHub Action:

```text
Sync Latest Release To Main
inputs:
  tag: v0.2.1
```

Behavior:

1. Wait until both `Publish npm Packages` and `Release CLI` have succeeded for
   the tag.
2. Compute the tag's release line, for example `v0.2.1 -> release/0.2`.
3. Compare all stable release tags and only continue if that line is the newest
   released line.
4. Skip if `main` already contains that release branch.
5. Open or update `automation/sync-release-0.2-to-main` as a PR into `main`
   with `release:none`.

## Bootstrap Workflow

Keep bootstrap manual and only for new npm package names.

Workflow:

```text
Bootstrap npm Packages
input:
  tag: v0.2.0
```

Behavior:

1. Check out the tag.
2. Use `NPM_BOOTSTRAP_TOKEN`.
3. Publish missing package names for that tag.
4. Error if the target version already exists.
5. Print trusted publishing commands afterward.

After bootstrap, configure npm trusted publishing for each new package, remove
the temporary bootstrap token, and revoke the npm token.

## PR Canary Workflow

Issue-comment workflow support:

```text
/rigkit canary
```

Behavior:

1. Only run on PRs.
2. Check commenter permissions.
3. Read the PR release label.
4. Compute the canary version from the label:

   ```text
   patch -> 0.1.10-pr.123.a1b2c3d
   minor -> 0.2.0-pr.123.a1b2c3d
   major -> 1.0.0-pr.123.a1b2c3d
   ```

5. Publish all public packages in release-config order.
6. Use dist-tag:

   ```text
   pr-123
   ```

7. Comment the published version back on the PR.

Canary releases must never publish to `latest`.

## Implemented Components

- `scripts/release/config.ts`
- `pnpm release:check`
- `pnpm release:preflight`
- `pnpm release:plan`
- `pnpm release:bump`
- `pnpm release:update-workflows`
- `pnpm release:prepare`
- `pnpm release:pack`
- `pnpm release:publish`
- `pnpm release:canary-version`
- `.github/workflows/check-release-label.yml`
- `.github/workflows/create-release-line.yml`
- `.github/workflows/prepare-patch-release.yml`
- `.github/workflows/prepare-minor-release.yml`
- `.github/workflows/prepare-major-release.yml`
- `.github/actions/prepare-release/action.yml`
- `.github/workflows/tag-release.yml`
- `.github/workflows/publish-npm.yml`
- `.github/workflows/release-cli.yml`
- `.github/workflows/bootstrap-npm.yml`
- `.github/workflows/canary.yml`
