import { cmux } from "@rigkit/provider-cmux";
import { freestyle, VmBaseImage, VmSpec } from "@rigkit/provider-freestyle";
import { workflow } from "@rigkit/sdk";

const vmSpec = new VmSpec()
  .baseImage(new VmBaseImage("FROM ubuntu:24.04"))
  .idleTimeoutSeconds(3600);

const app = workflow("cmux-playground", {
  providers: {
    freestyle: freestyle.provider(),
    cmux: cmux.provider(),
  },
});

export default app
  .sequence("cmux-playground")
  .task("create-vm", async ({ freestyle, step }) => {
    const { vm, vmId } = await freestyle.client.vms.create({
      spec: vmSpec,
      logger: step.log,
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
        logger: step.log,
      });
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
        command: "echo hello world",
        focus: true,
      });
    },
  });
