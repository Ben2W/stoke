import { defineConfig, sequence } from "@rigkit/sdk";
import { freestyle, VmBaseImage, VmSpec } from "@rigkit/provider-freestyle";

const smoke = sequence("smoke")
  .step("create-workflow", async ({ providers, step }) => {
    console.log("Create Workflow Step");

    const randomNumber = Math.floor(Math.random() * 1000);

    return { ctx: { randomNumber } };
  })
  .workspace({
    create: async ({ workflow, providers, step }) => {
      console.log("Create Workspace Step");

      const { randomNumber } = workflow.ctx;

      step.log(`Random number generated in workflow: ${randomNumber}`);
      return {};
    },
    remove: async () => {},
  })
  .workspaceOperation("ssh", {
    title: "SSH",
    description: "Open an interactive SSH session",
    run: async ({ providers, workspace, step }) => {
      step.log(`Ran Create`);
    },
  });

export default defineConfig({
  providers: {},
  workflows: {
    smoke,
  },
});
