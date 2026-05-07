import { env, workflow } from "@freestyle-sh/fdev-sdk";
import { freestyle } from "@freestyle-sh/fdev-provider-freestyle";

const app = workflow("smoke", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: env("FREESTYLE_API_KEY"),
      image: "ubuntu-24.04",
    }),
    terminal: freestyle.terminal(),
  },
});

export default app
  .sequence("smoke")
  .task("create-vm", async ({ freestyle }) => {
    const vm = await freestyle.vms.create();
    return { vm: await vm.snapshotRef() };
  })
  .task("install-gcloud-cli", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
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
  .task("gcloud-login", async ({ ctx, freestyle, terminal }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    const loggedIn = await vm.probe(
      "gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .",
      {
        name: "check active gcloud account",
      },
    );
    if (loggedIn.ok) return { vm: await vm.snapshotRef() };

    await terminal.open("Log in to gcloud", {
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
    source: (ctx) => ctx.vm,
  });
