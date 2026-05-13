import { env, workflow } from "@rigkit/sdk";
import { freestyle } from "@rigkit/provider-freestyle";
import {
  copyGcloudConfig,
  gcloudConfigCopyInjectionSteps,
  gcloudCopiedConfigReadyCommand,
} from "@rigkit/provider-gcloud-cli";
import type { FreestyleVmSnapshotRef } from "@rigkit/provider-freestyle";

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
        "local gcloud config files are copied by the inject-gcloud workspace operation",
    };
  })
  .workspace({
    create: async ({ ctx, providers, resources }) => {
      const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);
      resources.set("vm", {
        providerId: "freestyle",
        resourceId: vm.vmId,
        kind: "vm",
        sourceRef: ctx.vm,
      });
      return {
        vmId: vm.vmId,
      };
    },
    remove: async ({ providers, workspace }) => {
      const vmResource = workspace.resources.vm;
      if (vmResource) await providers.freestyle.vms.delete(vmResource.resourceId);
    },
  })
  .workspaceOperation("inject-gcloud", {
    title: "Inject gcloud",
    description: "Copy local gcloud config files into the workspace VM",
    run: async ({ providers, workspace }) => {
      const vmResource = workspace.resources.vm;
      if (!vmResource) throw new Error(`Workspace ${workspace.name} does not have a Freestyle VM resource`);
      const vm = providers.freestyle.vms.fromId(vmResource.resourceId);
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
