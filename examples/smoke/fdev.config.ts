import { defineDevMachine, defineStep, env } from "@freestyle-sh/fdev-sdk";
import { defineFreestyleProvider } from "@freestyle-sh/fdev-provider-freestyle";

const installGcloudCliStep = defineStep(
  "fdev:install-gcloud-cliaa",
  async ({ vm }) => {
    const installed = await vm.probe("command -v gcloud", {
      name: "check gcloud cli",
    });
    if (installed.ok) return;

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
  },
);

const gcloudLoginStep = defineStep(
  "fdev:gcloud-login",
  { dependsOn: [installGcloudCliStep] },
  async ({ interact, vm }) => {
    const loggedIn = await vm.probe(
      "gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .",
      {
        name: "check active gcloud account",
      },
    );
    if (loggedIn.ok) return;

    await interact.terminal("Log in to gcloud", {
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
  },
);

export default defineDevMachine({
  name: "smoke",
  provider: defineFreestyleProvider({
    apiKey: env("FREESTYLE_API_KEY"),
    image: "ubuntu-24.04",
  }),
  steps: [installGcloudCliStep, gcloudLoginStep],
});
