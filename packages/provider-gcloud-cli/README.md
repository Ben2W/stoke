# @rigkit/provider-gcloud-cli

Copy local `gcloud` config/auth files into rigkit workspaces.

This provider does not own Google OAuth. It requires the developer's local machine to have `gcloud` installed and authenticated, then copies selected files from the local gcloud config directory into a workspace. This makes normal VM-side commands such as `gcloud auth list` behave like they do locally.

```ts
import { workflow } from "@rigkit/sdk";
import {
  copyGcloudConfig,
  gcloudConfigCopyInjectionSteps,
  gcloudCopiedConfigReadyCommand,
} from "@rigkit/provider-gcloud-cli";

const app = workflow("example", {
  providers: {
    gcloudConfig: copyGcloudConfig.provider({
      requireAuth: true,
    }),
  },
});

// Inside a workspace operation:
const gcloudConfigFiles = await providers.gcloudConfig.configFiles();
for (const step of gcloudConfigCopyInjectionSteps(gcloudConfigFiles)) {
  await vm.exec(step.command, { name: step.name, env: step.env });
}

const verified = await vm.exec(gcloudCopiedConfigReadyCommand());
if ((verified.statusCode ?? 0) !== 0) {
  throw new Error("gcloud did not accept the copied config files");
}
```

By default, provider startup requires local `gcloud` to be installed and authenticated before Rigkit runs project commands. If local `gcloud` is missing, startup fails with the Google Cloud SDK install URL. If it is not authenticated, startup asks the user to run `gcloud auth login`.
