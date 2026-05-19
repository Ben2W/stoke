import { cmux } from "@rigkit/provider-cmux";
import { freestyle, VmBaseImage } from "@rigkit/provider-freestyle";
import { workflow } from "@rigkit/sdk";

const app = workflow("cmux-playground", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: process.env.FREESTYLE_API_KEY,
    }),
    cmux: cmux.provider(),
  },
});

export const cmuxPlayground = app
  .sequence("cmux-playground")
  .task("create-snapshot", async ({ freestyle, step }) => {
    const { vm, vmId } = await freestyle.client.vms.create({
      idleTimeoutSeconds: 3600,
      logger: console.log,
    });

    try {
      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await freestyle.client.vms.delete({ vmId });
    }
  })
  .workspace({
    create: async ({ workflow, providers, step }) => {
      const { vmId } = await providers.freestyle.client.vms.create({
        snapshotId: workflow.ctx.snapshotId,
        idleTimeoutSeconds: 3600,
        logger: console.log,
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));

      return { vmId };
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.client.vms.delete({ vmId: workspace.ctx.vmId });
    },
  })
  .workspaceOperation("open", {
    title: "Open",
    description: "Open a cmux workspace",
    run: async ({ providers, workspace }) => {
      await providers.cmux.open({
        name: workspace.name,
        ssh: await providers.freestyle.cmux.createSshOptions({
          vmId: workspace.ctx.vmId,
        }),
        terminals: [{ command: "echo hello world" }],
        focus: true,
      });
    },
  });
