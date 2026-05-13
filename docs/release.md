# Release And Package Process

`rig` releases are tag-driven. A `v*` tag points at the exact commit that should become both the npm release and the GitHub CLI binary release.

## Normal Release

Use this path for ordinary version bumps after all packages already exist on npm and have trusted publishing configured.

```bash
git checkout main
git pull

# Update package versions and version constants first. Example:
#   packages/*/package.json: 0.1.9
#   packages/*/src/version.ts: 0.1.9
#   packages/sdk/src/runtime/version.ts: 0.1.9
pnpm release:check
pnpm typecheck
pnpm test
pnpm build
pnpm build:cli-binaries

git commit -am "Release Rigkit packages 0.1.9"
git tag v0.1.9
git push origin main
git push origin v0.1.9
```

Pushing a `v*` tag runs:

- `.github/workflows/publish-npm.yml`
- `.github/workflows/release-cli.yml`

`publish-npm.yml` publishes npm packages through npm Trusted Publishing. It does not use `NPM_TOKEN` or `NPM_BOOTSTRAP_TOKEN`.

`release-cli.yml` builds the Bun-compiled `rig` binaries, smoke-tests the Linux binary, and creates the GitHub Release assets.

The release tag, package versions, and hardcoded runtime versions must match exactly. `pnpm release:check` enforces this.

```text
tag:                                      v0.1.9
@rigkit/engine:                          0.1.9
@rigkit/runtime-client:                  0.1.9
@rigkit/sdk:                             0.1.9
@rigkit/provider-freestyle:              0.1.9
@rigkit/provider-gcloud-cli:             0.1.9
@rigkit/provider-cmux:                   0.1.9
@rigkit/provider-vscode:                 0.1.9
@rigkit/cli:                             0.1.9
packages/sdk/src/runtime/version.ts:     0.1.9
```

## Published Packages

The npm workflow packs and publishes packages in dependency order:

```text
@rigkit/engine
@rigkit/runtime-client
@rigkit/sdk
@rigkit/provider-freestyle
@rigkit/provider-gcloud-cli
@rigkit/provider-cmux
@rigkit/provider-vscode
@rigkit/cli
```

Workspace dependencies should stay as `workspace:*` in the repo. The workflow runs `pnpm pack`, which converts workspace dependencies to the concrete release version inside each packed tarball.

Project users should install `@rigkit/sdk` plus the provider or integration packages they use. Legacy `@freestyle-sh/fdev*` packages are deprecated; do not add new dependencies on those package names.

## Trusted Publishing

Every publishable package must have npm Trusted Publishing configured for GitHub Actions:

```bash
npx npm@latest trust github @rigkit/engine --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/runtime-client --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/sdk --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-freestyle --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-gcloud-cli --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-cmux --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-vscode --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/cli --repo freestyle-sh/rigkit --file publish-npm.yml -y
```

The `npm trust` command may require interactive npm 2FA or browser auth. Run it from a local terminal where the npm prompt can be completed.

## Bootstrapping npm Packages

Use this path only when a publishable package name does not exist on npm yet, such as the first release under a new npm scope or when adding a new package. npm trusted publishers can only be configured after the package exists, so bootstrap uses a temporary npm token once, then normal releases go back to trusted publishing.

Do not use bootstrap for normal version bumps. Once all package names exist and have trusted publishing configured, use the normal tag release flow above.

Bootstrap flow:

1. Create the release commit and tag first. The package versions, version constants, and tag must match.
2. Create a temporary npm granular token with publish access to the `@rigkit` scope and `Bypass 2FA` enabled.
3. Add it as a GitHub repo secret named `NPM_BOOTSTRAP_TOKEN`.
4. Run the manual bootstrap workflow with the release tag:

```bash
gh workflow run bootstrap-npm.yml -f tag=v0.1.9
```

5. Verify the packages exist:

```bash
npm view @rigkit/sdk version
npm view @rigkit/runtime-client version
```

6. Configure trusted publishing for each new package:

```bash
npx npm@latest trust github @rigkit/engine --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/runtime-client --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/sdk --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-freestyle --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-gcloud-cli --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-cmux --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/provider-vscode --repo freestyle-sh/rigkit --file publish-npm.yml -y
npx npm@latest trust github @rigkit/cli --repo freestyle-sh/rigkit --file publish-npm.yml -y
```

7. Verify trusted publishing:

```bash
npx npm@latest trust list @rigkit/engine
npx npm@latest trust list @rigkit/runtime-client
npx npm@latest trust list @rigkit/sdk
npx npm@latest trust list @rigkit/provider-freestyle
npx npm@latest trust list @rigkit/provider-gcloud-cli
npx npm@latest trust list @rigkit/provider-cmux
npx npm@latest trust list @rigkit/provider-vscode
npx npm@latest trust list @rigkit/cli
```

8. Delete the `NPM_BOOTSTRAP_TOKEN` secret and revoke the temporary npm token.

If a tag release includes a new package name, `publish-npm.yml` will detect the missing package and skip npm publishing. That is expected. Run `bootstrap-npm.yml` for that tag, configure trust for the new package, then use the normal tag flow for later releases.

## Adding A Publishable Package

Use this checklist when adding a package that should be published to npm.

1. Create the package under `packages/<package-name>/`.
2. Add `package.json` with the standard fields:

```json
{
  "name": "@rigkit/sdk-example",
  "version": "0.1.9",
  "type": "module",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/freestyle-sh/rigkit.git",
    "directory": "packages/example"
  },
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "files": [
    "src",
    "README.md"
  ],
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Add `bin`, extra `exports`, or a `prepack` build only when the package actually needs them.

3. Add `tsconfig.json`, `README.md`, `src/index.ts`, and `src/version.ts`.
4. Add the package to `scripts/check-release-versions.ts` with its version constant.
5. Add the package to both npm workflows:
   - `.github/workflows/publish-npm.yml`
   - `.github/workflows/bootstrap-npm.yml`
6. Place it in the workflow publish order after its workspace dependencies and before packages that depend on it.
7. Add workspace dependencies from other packages as `workspace:*`.
8. Run `pnpm install` if package dependencies changed, then commit the lockfile if it changed.
9. Run the full local release check set:

```bash
pnpm release:check
pnpm typecheck
pnpm test
pnpm build
pnpm build:cli-binaries
```

10. Release the new package name through the bootstrap flow above.

Do not publish a new package manually from a laptop except through the documented bootstrap workflow. npm publishing should remain CI-owned so packed workspace dependencies and release checks stay consistent.

## Private Workspace Packages

Private packages under `apps/*`, `examples/*`, or `packages/*` do not need npm workflow entries or trusted publishing.

Private package rules:

- Set `"private": true`.
- Keep versions at `0.0.0` unless the package has its own reason to track releases.
- Do not add it to `scripts/check-release-versions.ts`.
- Do not add it to `publish-npm.yml` or `bootstrap-npm.yml`.

## Branches Vs Tags

Branches are where development happens. Tags are immutable release markers.

For now, release from `main` by tagging a known-good commit. A release branch is only needed when maintaining older release lines while `main` moves ahead.

```text
main          future 0.2.x work
release/0.1  0.1.x hotfixes
v0.1.9        tag on a release/0.1 commit
```

Even with release branches, the published artifact still comes from a tag.

## Installer Deployment

The public installer is served by the install Worker:

```bash
curl -fsSL https://rigkit.freestyle.sh/install | sh
```

The Worker uses GitHub Releases as the source of truth, serves latest-version metadata, and redirects downloads to GitHub release assets. No R2 bucket is used.

Normal CLI releases do not require a Worker deployment. Once `release-cli.yml` creates a new GitHub Release, the Worker exposes that release as latest.

Deploy the Worker only when `apps/install-worker` changes:

```bash
pnpm --filter @rigkit/install-worker deploy
```

Set `GITHUB_TOKEN` as a Worker secret so metadata requests use authenticated GitHub API quota:

```bash
pnpm --filter @rigkit/install-worker exec wrangler secret put GITHUB_TOKEN
```

Use a fine-grained, read-only token scoped to `freestyle-sh/rigkit`.

For local Worker development, copy `apps/install-worker/.dev.vars.example` to `apps/install-worker/.dev.vars` and set the same value there. `.dev.vars` is ignored by git.

The installer writes the binary to `~/.rigkit/bin/rig` by default and adds `~/.rigkit/bin` to the detected shell profile. Set `RIGKIT_INSTALL_DIR` to override the install location, or `RIGKIT_NO_MODIFY_PATH=1` to skip shell profile edits.

The repo-local `scripts/install-rigkit.sh` remains a fallback for direct GitHub installs.
