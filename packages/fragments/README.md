# @rigkit/fragments

Reusable workflow fragments for Rigkit configs.

The package currently exports `freestyleCompanyBaseFragment`, an opinionated
global Freestyle base fragment. It creates a Freestyle VM, installs common
development tooling, initializes the enabled interactive CLIs, snapshots the VM,
and stores that snapshot in Rigkit's global fragment cache. Repos can then build
their project-specific setup on top of the same base snapshot.

Installed by default:

- Git and common build packages
- GitHub CLI
- Node.js 22 and npm
- Bun
- Codex CLI
- Claude Code

```ts
import { freestyle } from "@rigkit/provider-freestyle";
import {
  freestyleCompanyBaseFragment,
  type FreestyleCompanyBaseFragmentContext,
} from "@rigkit/fragments";
import { workflow } from "@rigkit/sdk";

const app = workflow("my-app", {
  providers: {
    freestyle: freestyle.provider(),
    terminal: freestyle.terminal(),
  },
});

const repoSetup = app
  .sequence<FreestyleCompanyBaseFragmentContext>("repo-setup")
  .task("clone-repo", async ({ freestyle, step }) => {
    const created = await freestyle.client.vms.create({
      snapshotId: step.ctx.snapshotId,
      idleTimeoutSeconds: step.ctx.freestyleCompanyBase.idleTimeoutSeconds,
      logger: step.log,
    });
    const { vm, vmId } = created;
    try {
      await vm.exec("git clone https://github.com/acme/app.git /workspace/app");
      const snapshot = await vm.snapshot();
      return { ctx: { ...step.ctx, snapshotId: snapshot.snapshotId, repoPath: "/workspace/app" } };
    } finally {
      await freestyle.client.vms.delete({ vmId });
    }
  });

export default app
  .sequence("my-app")
  .add(freestyleCompanyBaseFragment())
  .add(repoSetup);
```

Repos can pass environment-backed overrides when individual developers need to
choose their own tool set or VM size. See
`examples/base-freestyle-fragment/rig.config.ts` for that pattern.

`freestyleCompanyBaseFragment(...)` intentionally exposes a small API: `github`,
`codex`, `claude`, and VM sizing. Those options are normalized into
`.configure(...)`, so they are part of the global fragment fingerprint. For
example, enabling Claude and disabling Claude produce different global cache
fragments.

Enabling a tool installs it and runs its auth/init task:

- `github: true` installs GitHub CLI, runs `gh auth login`, and configures Git
  author identity from the authenticated account.
- `codex: true` installs Codex CLI and opens `codex` in a Freestyle terminal for
  login/initialization.
- `claude: true` installs Claude Code and opens `claude` in a Freestyle terminal
  for login/initialization.

Authenticated global fragments can contain developer or org credentials. Use
them only when that is the intended cache boundary.
