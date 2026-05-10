import { createCmuxClient } from "@freestyle-sh/fdev-cmux";
import { freestyle } from "@freestyle-sh/fdev-provider-freestyle";
import { env, workflow } from "@freestyle-sh/fdev";

const cmux = createCmuxClient();

const app = workflow("cmux-playground", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: env("FREESTYLE_API_KEY"),
      image: "ubuntu-24.04",
    }),
  },
});

export default app
  .sequence("cmux-playground")
  .task("create-vm", async ({ freestyle }) => {
    const vm = await freestyle.vms.create();
    return { vm: await vm.snapshotRef() };
  })
  .workspace({
    source: (ctx) => ctx.vm,
    onCreated: async ({ workspace }) => {
      await cmux.newWorkspace({
        name: workspace.name,
        command: "echo hello world",
        focus: true,
      });
    },
  });
