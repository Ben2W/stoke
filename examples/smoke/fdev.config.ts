import { defineDevMachine, defineStep, env } from "@freestyle-sh/fdev-sdk";
import { defineFreestyleProvider } from "@freestyle-sh/fdev-provider-freestyle";

const smokeStep = defineStep("fdev:smoke", async ({ vm, step }) => {
  const ready = await vm.exec("test -f /tmp/fdev-ready").catch(() => null);
  if (ready?.ok) return;

  await step.exec("echo ready > /tmp/fdev-ready", { name: "write fdev marker" });
  if (!(await vm.exists("/tmp/fdev-ready"))) throw new Error("fdev marker was not created");
});

export default defineDevMachine({
  name: "smoke",
  provider: defineFreestyleProvider({
    apiKey: env("FREESTYLE_API_KEY"),
  }),
  image: "ubuntu-24.04",
  steps: [smokeStep],
});
