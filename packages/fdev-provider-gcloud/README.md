# @freestyle-sh/fdev-provider-gcloud

Copy local `gcloud` config/auth files into fdev workspaces.

This provider does not own Google OAuth. It requires the developer's local machine to have `gcloud` installed and authenticated, then copies selected files from the local gcloud config directory into a workspace. This makes normal VM-side commands such as `gcloud auth list` behave like they do locally.

```ts
import { workflow } from "@freestyle-sh/fdev-sdk";
import {
  copyGcloudConfig,
  gcloudConfigCopyInjectionSteps,
  gcloudCopiedConfigReadyCommand,
} from "@freestyle-sh/fdev-provider-gcloud";

const app = workflow("example", {
  providers: {
    gcloudConfig: copyGcloudConfig.provider(),
  },
});

// Inside workspace.onOpen:
const gcloudConfigFiles = await providers.gcloudConfig.configFiles();
for (const step of gcloudConfigCopyInjectionSteps(gcloudConfigFiles)) {
  await vm.exec(step.command, { name: step.name, env: step.env });
}

const verified = await vm.probe(gcloudCopiedConfigReadyCommand());
if (!verified.ok) throw new Error("gcloud did not accept the copied config files");
```

If local `gcloud` is missing, provider startup fails with the Google Cloud SDK install URL. If it is not authenticated, startup asks the user to run `gcloud auth login`.
