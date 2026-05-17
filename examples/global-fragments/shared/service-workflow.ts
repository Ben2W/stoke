import {
  sequence,
  type WorkflowNodeOutput,
  type WorkflowProviderMap,
} from "@rigkit/sdk";
import { baseDependencies } from "./base-dependencies.ts";

type BaseDependenciesContext = WorkflowNodeOutput<typeof baseDependencies>;

export type ServiceWorkflowOptions = {
  id: string;
  packageName: string;
  sourceDir: string;
  devCommand: string;
};

export function serviceWorkflow(options: ServiceWorkflowOptions) {
  const serviceSetup = sequence<WorkflowProviderMap, BaseDependenciesContext>(
    `${options.id}-setup`,
  )
    .configure({
      packageName: options.packageName,
      sourceDir: options.sourceDir,
      devCommand: options.devCommand,
    })
    .task("install-service", async ({ config, step }) => {
      const packageName = String(config.packageName);
      const sourceDir = String(config.sourceDir);
      const devCommand = String(config.devCommand);

      console.log(`installing ${packageName} from ${sourceDir}`);

      return {
        ctx: {
          ...step.ctx,
          service: {
            id: options.id,
            packageName,
            sourceDir,
            devCommand,
            installReceipt: `${step.ctx.packageStoreKey}:${packageName}`,
          },
        },
      };
    });

  return sequence(options.id)
    .add(baseDependencies.global())
    .add(serviceSetup)
    .workspace({
      create: async ({ workflow, workspace }) => ({
        serviceId: options.id,
        name: workspace.name,
        packageName: workflow.ctx.service.packageName,
        sourceDir: workflow.ctx.service.sourceDir,
        devCommand: workflow.ctx.service.devCommand,
        toolchain: workflow.ctx.toolchain,
        packageStoreKey: workflow.ctx.packageStoreKey,
      }),
      remove: async () => {},
    })
    .workspaceOperation("status", {
      title: "Status",
      description: "Return the prepared service workspace context",
      run: async ({ workspace }) => ({
        workspace: workspace.name,
        serviceId: workspace.ctx.serviceId,
        packageName: workspace.ctx.packageName,
        devCommand: workspace.ctx.devCommand,
        packageStoreKey: workspace.ctx.packageStoreKey,
      }),
    });
}
