import { sequence } from "@rigkit/sdk";

export const smoke = sequence("smoke")
  .step("create-workflow", async () => {
    console.log("Create Workflow Step");
    const randomNumber = Math.floor(Math.random() * 1000);
    return { ctx: { randomNumber } };
  })
  .workspace({
    create: async ({ workflow }) => {
      console.log(`Random number generated in workflow: ${workflow.ctx.randomNumber}`);
      return {};
    },
    remove: async () => {},
  })
  .workspaceOperation("ssh", {
    title: "SSH",
    description: "Open an interactive SSH session",
    run: async () => {
      console.log("Ran Create");
    },
  });
