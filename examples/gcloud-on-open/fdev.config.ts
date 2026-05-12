import { env, workflow } from "@freestyle-sh/fdev";
import { freestyle } from "@freestyle-sh/fdev-provider-freestyle";
import {
  copyGcloudConfig,
  gcloudConfigCopyInjectionSteps,
  gcloudCopiedConfigReadyCommand,
} from "@freestyle-sh/fdev-provider-gcloud";
import type { FreestyleVmSnapshotRef } from "@freestyle-sh/fdev-provider-freestyle";

type VmContext = {
  vm: FreestyleVmSnapshotRef;
};

const app = workflow("gcloud-on-open", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: env("FREESTYLE_API_KEY"),
      image: "ubuntu-24.04",
      memory: "16GB",
      cpu: 4,
    }),
    gcloudConfig: copyGcloudConfig.provider(),
  },
});

const baseVm = app
  .sequence("base-vm")
  .task("create", async ({ freestyle }) => {
    const vm = await freestyle.vms.create();
    return { vm: await vm.snapshotRef() };
  })
  .task("install-gcloud-cli", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec(installGcloudCliCommand(), {
      name: "install gcloud cli",
      timeoutMs: 10 * 60 * 1000,
    });

    return { vm: await vm.snapshotRef() };
  });

export default app
  .sequence("gcloud-workspace")
  .add(baseVm)
  .task("marker", async ({ ctx }) => {
    return {
      vm: ctx.vm,
      workspaceNote:
        "local gcloud config files are copied from workspace.onOpen",
    };
  })
  .workspace({
    source: (ctx) => ctx.vm,
    onOpen: async ({ providers, workspace }) => {
      const vm = providers.freestyle.vms.fromWorkspace(workspace);
      const gcloudConfigFiles = await providers.gcloudConfig.configFiles();
      for (const step of gcloudConfigCopyInjectionSteps(gcloudConfigFiles)) {
        await vm.exec(step.command, {
          name: step.name,
          env: step.env,
        });
      }

      const verified = await vm.probe(gcloudCopiedConfigReadyCommand(), {
        name: "verify copied gcloud config",
      });
      if (!verified.ok) {
        throw new Error("gcloud did not accept the copied config files");
      }

      const ssh = await vm.ssh();
      console.log(
        [
          `SSH command:\n${ssh.command}`,
          "",
          "Verify inside the VM with: gcloud auth list",
        ].join("\n"),
      );
    },
  });

function installGcloudCliCommand(): string {
  return [
    "set -e",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq ca-certificates curl gnupg",
    "if ! command -v gcloud >/dev/null 2>&1; then",
    "  mkdir -p /etc/apt/keyrings",
    "  rm -f /etc/apt/keyrings/google-cloud-cli.gpg",
    "  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /etc/apt/keyrings/google-cloud-cli.gpg",
    "  chmod go+r /etc/apt/keyrings/google-cloud-cli.gpg",
    "  printf 'deb [signed-by=/etc/apt/keyrings/google-cloud-cli.gpg] https://packages.cloud.google.com/apt cloud-sdk main\\n' > /etc/apt/sources.list.d/google-cloud-sdk.list",
    "  apt-get update -qq",
    "  apt-get install -y -qq google-cloud-cli",
    "fi",
    "gcloud --version",
  ].join("\n");
}
