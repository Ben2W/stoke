import { workflow } from "@rigkit/sdk";
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
      image: "ubuntu-24.04",
      memory: "16GB",
      cpu: 4,
    }),
    gcloudConfig: copyGcloudConfig.provider({
      requireAuth: true,
    }),
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
    create: async ({ workflow, providers }) => {
      const gcloudConfigFiles = await providers.gcloudConfig.configFiles();

      const vm = await providers.freestyle.vms.fromSnapshot(workflow.ctx.vm);

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

      return {
        vmId: vm.vmId,
      };
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.vms.delete(workspace.ctx.vmId);
    },
  })
  .workspaceOperation("ssh", {
    title: "SSH",
    description: "Open an SSH session to the workspace VM",
    run: async ({ providers, workspace, local }) => {
      if (!local.command) {
        throw new Error("This host does not support interactive commands");
      }

      const vm = providers.freestyle.vms.fromId(workspace.ctx.vmId);
      const ssh = await vm.ssh();

      const commandResult = await local.command({
        argv: ["sh", "-lc", ssh.command],
        mode: "interactive",
        reason: `Open SSH session to ${workspace.name}`,
        presentation: {
          visible: true,
          label: `SSH ${workspace.name}`,
        },
      });

      return {
        command: ssh.command,
        commandResult,
      };
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
