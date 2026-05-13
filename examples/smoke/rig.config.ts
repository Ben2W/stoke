import { defineConfig, sequence } from "@rigkit/sdk";
import { freestyle } from "@rigkit/provider-freestyle";

const freestyleProvider = freestyle.provider({
  image: "ubuntu-24.04",
});

const smoke = sequence("smoke")
  .step("create-vm", async ({ providers }) => {
    console.log("Creating VM...");
    const vm = await providers.freestyle.vms.create();
    return { vm: await vm.snapshotRef() };
  })
  .step("install-gcloud-cli", async ({ ctx, providers }) => {
    const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);
    const installed = await vm.probe("command -v gcloud", {
      name: "check gcloud cli",
    });
    if (installed.ok) return { vm: await vm.snapshotRef() };

    await vm.exec(
      [
        "export DEBIAN_FRONTEND=noninteractive",
        "sudo apt-get update",
        "sudo apt-get install -y apt-transport-https ca-certificates curl gnupg",
        "curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor | sudo tee /usr/share/keyrings/cloud.google.gpg >/dev/null",
        "echo 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list",
        "sudo apt-get update",
        "sudo apt-get install -y google-cloud-cli",
      ].join(" && "),
      {
        name: "install gcloud cli",
      },
    );

    if (!(await vm.probe("command -v gcloud")).ok) {
      throw new Error("gcloud cli was not installed");
    }

    return { vm: await vm.snapshotRef() };
  })
  .step("gcloud-login", async ({ ctx, providers }) => {
    const vm = await providers.freestyle.vms.fromSnapshot(ctx.vm);
    const loggedIn = await vm.probe(
      "gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .",
      {
        name: "check active gcloud account",
      },
    );
    if (loggedIn.ok) return { vm: await vm.snapshotRef() };

    await providers.terminal.open("Log in to gcloud", {
      target: vm,
      command: "gcloud auth login",
      instructions:
        "Complete Google authentication in the browser, then return to the terminal once login finishes.",
    });

    const activeAccount = await vm.probe(
      "gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .",
      {
        name: "verify active gcloud account",
      },
    );

    if (!activeAccount.ok) {
      throw new Error("no active gcloud account found after interactive login");
    }

    return { vm: await vm.snapshotRef() };
  })
  .workspace({
    create: async ({ workflow, providers }) => {
      const vm = await providers.freestyle.vms.fromSnapshot(workflow.ctx.vm);
      return { vmId: vm.vmId, ready: true };
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.vms.delete(workspace.ctx.vmId);
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
