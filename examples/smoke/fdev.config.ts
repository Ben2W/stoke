import { defineDevMachine, defineMigration, env } from "@freestyle/fdev-sdk";

const smokeMigration = defineMigration("fdev:smoke", async ({ vm, step }) => {
  const ready = await vm.exec("test -f /tmp/fdev-ready").catch(() => null);
  if (ready?.ok) return;

  await step.run("write fdev marker", "echo ready > /tmp/fdev-ready");

  await step.assert("verify fdev marker", async ({ vm }) => {
    const result = await vm.exec("test -f /tmp/fdev-ready").catch(() => null);
    return Boolean(result?.ok);
  });
});

export default defineDevMachine({
  name: "smoke",
  apiKey: env("FREESTYLE_API_KEY"),
  image: "ubuntu-24.04",
  migrations: [smokeMigration],
});
