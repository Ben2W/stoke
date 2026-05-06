import { defineDevMachine, defineStep, env } from "@freestyle-sh/fdev-sdk";
import { defineFreestyleProvider } from "@freestyle-sh/fdev-provider-freestyle";

const smokeStep = defineStep("fdev:smoke", async ({ vm }) => {
  const ready = await vm.probe("test -f /tmp/fdev-ready", {
    name: "check fdev marker",
  });
  if (ready.ok) return;

  await vm.exec("echo ready > /tmp/fdev-ready", {
    name: "write fdev marker",
  });
  if (!(await vm.exists("/tmp/fdev-ready")))
    throw new Error("fdev marker was not created");
});

export default defineDevMachine({
  name: "smoke",
  provider: defineFreestyleProvider({
    apiKey: env("FREESTYLE_API_KEY"),
  }),
  image: "ubuntu-24.04",
  steps: [smokeStep],
});
