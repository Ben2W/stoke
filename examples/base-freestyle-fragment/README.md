# Base Freestyle Fragment Example

This example shows a repo config consuming the reusable
`withFreestyleCompanyBase` export from `@rigkit/fragments`.

The workflow has two layers:

- `freestyle-company-base`: a global fragment that installs and initializes the
  shared company toolchain.
- `company-project-setup`: a repo-local layer that starts from the global base
  snapshot and adds project-specific files.
- `freestyle-company-base-auth-check`: a local, uncached GitHub auth check that
  runs after repo setup and can invalidate stale global auth.

Run from this directory:

```bash
rig plan --workflow base-freestyle-fragment-example
rig apply --workflow base-freestyle-fragment-example
rig create --workflow base-freestyle-fragment-example base-fragment-workspace
rig run base-fragment-workspace status --json
rig run base-fragment-workspace ssh
```

By default, the base fragment installs and initializes GitHub CLI, Codex, and
Claude Code. That means `rig apply` opens browser terminal sessions for the
enabled auth/init steps.

Developers can override the base fragment options with environment variables:

```bash
RIGKIT_BASE_CLAUDE=0 rig apply --workflow base-freestyle-fragment-example
RIGKIT_BASE_CODEX=0 rig apply --workflow base-freestyle-fragment-example
RIGKIT_BASE_MEM_SIZE_GB=32 rig apply --workflow base-freestyle-fragment-example
```

Available overrides:

- `RIGKIT_BASE_GITHUB`
- `RIGKIT_BASE_CODEX`
- `RIGKIT_BASE_CLAUDE`
- `RIGKIT_BASE_HOME`
- `RIGKIT_BASE_MEM_SIZE_GB`
- `RIGKIT_BASE_VCPU_COUNT`
- `RIGKIT_BASE_ROOTFS_SIZE_GB`

Enabling `RIGKIT_BASE_GITHUB`, `RIGKIT_BASE_CODEX`, or `RIGKIT_BASE_CLAUDE`
installs the tool and runs its auth/init step. Disabling one skips both install
and auth/init.

The resolved options are passed into `.configure(...)`, so different developer
choices get different global fragment fingerprints instead of reusing an
incompatible cache entry.
