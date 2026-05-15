import { defineConfig, sequence } from "@rigkit/sdk";
import {
  freestyle,
  VmBaseImage,
  VmSpec,
} from "@rigkit/provider-freestyle";

const vmIdleTimeoutSeconds = 3600;

const vmSpec = new VmSpec()
  .baseImage(new VmBaseImage("FROM ubuntu:24.04"))
  .idleTimeoutSeconds(vmIdleTimeoutSeconds);

const freestyleProvider = freestyle.provider();

const smoke = sequence("smoke")
  .step("create-vm", async ({ providers, step }) => {
    console.log("Creating VM...");
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      spec: vmSpec,
      logger: step.log,
    });
    try {
      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .step("install-gcloud-cli", async ({ step, providers }) => {
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      snapshotId: step.ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: step.log,
    });
    try {
      const installed = await vm.exec("command -v gcloud");
      if ((installed.statusCode ?? 0) !== 0) {
        step.log("installing gcloud cli");
        const install = await vm.exec([
          "set -e",
          "export DEBIAN_FRONTEND=noninteractive",
          "apt-get update",
          "apt-get install -y apt-transport-https ca-certificates curl gnupg",
          "curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor > /usr/share/keyrings/cloud.google.gpg",
          "echo 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' > /etc/apt/sources.list.d/google-cloud-sdk.list",
          "apt-get update",
          "apt-get install -y google-cloud-cli",
        ].join("\n"));
        if ((install.statusCode ?? 0) !== 0) {
          throw new Error(`gcloud cli install failed:\n${install.stdout ?? ""}${install.stderr ?? ""}`.trim());
        }

        const installedAfter = await vm.exec("command -v gcloud");
        if ((installedAfter.statusCode ?? 0) !== 0) {
          throw new Error("gcloud cli was not installed");
        }
      }

      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .step("gcloud-login", async ({ step, providers }) => {
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      snapshotId: step.ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: step.log,
    });
    try {
      const loggedIn = await vm.exec("gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .");
      if ((loggedIn.statusCode ?? 0) !== 0) {
        await providers.terminal.open("Log in to gcloud", {
          ssh: await providers.freestyle.createSSHOptions({ vmId }),
          command: "gcloud auth login",
          instructions:
            "Complete Google authentication in the browser, then return to the terminal once login finishes.",
        });

        const activeAccount = await vm.exec("gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .");

        if ((activeAccount.statusCode ?? 0) !== 0) {
          throw new Error("no active gcloud account found after interactive login");
        }
      }

      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .workspace({
    create: async ({ workflow, providers, step }) => {
      const { vmId } = await providers.freestyle.client.vms.create({
        snapshotId: workflow.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: step.log,
      });
      return { vmId, ready: true };
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.client.vms.delete({ vmId: workspace.ctx.vmId });
    },
  })
  .workspaceOperation("ssh", {
    title: "SSH",
    description: "Open an interactive SSH session",
    run: async ({ providers, workspace }) => {
      await providers.terminal.open(`SSH ${workspace.name}`, {
        ssh: await providers.freestyle.createSSHOptions({ vmId: workspace.ctx.vmId }),
        instructions: "Exit the SSH session when you are done.",
      });
    },
  });

export default defineConfig({
  providers: {
    freestyle: freestyleProvider,
    terminal: freestyle.terminal(),
  },
  workflows: {
    smoke,
  },
});
