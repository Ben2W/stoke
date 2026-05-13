import { cmux } from "@rigkit/provider-cmux";
import { freestyle } from "@rigkit/provider-freestyle";
import { env, workflow } from "@rigkit/sdk";

const app = workflow("cmux-playground", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: env("FREESTYLE_API_KEY"),
      image: "ubuntu-24.04",
    }),
    cmux: cmux.provider(),
  },
});

export default app
  .sequence("cmux-playground")
  .task("create-vm", async ({ freestyle }) => {
    const vm = await freestyle.vms.create();
    return { vm: await vm.snapshotRef() };
  })
  .workspace({
    create: async () => ({}),
    remove: async () => {},
  })
  .workspaceOperation("open", {
    title: "Open",
    description: "Open a cmux workspace",
    run: async ({ providers, workspace }) => {
      await providers.cmux.open({
        name: workspace.name,
        command: "echo hello world",
        focus: true,
      });
    },
  });
