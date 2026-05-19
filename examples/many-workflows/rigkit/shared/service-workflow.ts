import {
  sequence,
  z,
  type WorkflowNodeOutput,
  type WorkflowProviderMap,
} from "@rigkit/sdk";
import type { ServiceDefinition } from "./catalog.ts";
import { baseToolchain } from "./toolchain.ts";

type BaseContext = WorkflowNodeOutput<typeof baseToolchain>;

export function serviceWorkflow(service: ServiceDefinition) {
  const serviceSetup = sequence<WorkflowProviderMap, BaseContext>(
    `${service.id}-setup`,
  )
    .configure({
      packageName: service.packageName,
      sourceDir: service.sourceDir,
      buildCommand: service.buildCommand,
      devCommand: service.devCommand,
      testCommand: service.testCommand,
      runtime: service.runtime,
      ports: service.ports,
      dependsOn: service.dependsOn,
    })
    .task("install-service", async ({ config, step }) => {
      const packageName = String(config.packageName);
      const sourceDir = String(config.sourceDir);

      return {
        ctx: {
          ...step.ctx,
          service: {
            id: service.id,
            packageName,
            sourceDir,
            dependencyReceipt: `${step.ctx.packageStore.key}:${packageName}`,
          },
        },
      };
    })
    .task("build-service", async ({ config, step }) => {
      const buildCommand = String(config.buildCommand);
      const artifactId = `${service.id}-artifact-${hashText(buildCommand)}`;

      return {
        ctx: {
          ...step.ctx,
          service: {
            ...step.ctx.service,
            buildCommand,
            artifactId,
            runtime: String(config.runtime),
            ports: stringArray(config.ports).map((port) => Number(port)),
            dependsOn: stringArray(config.dependsOn),
          },
        },
      };
    })
    .task("prepare-workspace-template", async ({ config, step }) => ({
      ctx: {
        ...step.ctx,
        workspaceTemplate: {
          serviceId: service.id,
          repoRoot: step.ctx.toolchain.repoRoot,
          sourceDir: step.ctx.service.sourceDir,
          devCommand: String(config.devCommand),
          testCommand: String(config.testCommand),
          artifactId: step.ctx.service.artifactId,
        },
      },
    }));

  return sequence(service.id)
    .add(baseToolchain.global())
    .add(serviceSetup)
    .workspace({
      create: async ({ workflow, workspace }) => ({
        name: workspace.name,
        serviceId: service.id,
        packageName: workflow.ctx.service.packageName,
        sourceDir: workflow.ctx.service.sourceDir,
        runtime: workflow.ctx.service.runtime,
        ports: workflow.ctx.service.ports,
        dependsOn: workflow.ctx.service.dependsOn,
        repoRoot: workflow.ctx.toolchain.repoRoot,
        packageStoreKey: workflow.ctx.packageStore.key,
        artifactId: workflow.ctx.workspaceTemplate.artifactId,
        devCommand: workflow.ctx.workspaceTemplate.devCommand,
        testCommand: workflow.ctx.workspaceTemplate.testCommand,
      }),
      remove: async () => {},
    })
    .workspaceOperation("release-notes", {
      title: "Release Notes",
      description: "Summarize the workflow output for release automation",
      input: z.object({
        release: z.string().min(1).describe("Release version"),
        channel: z
          .enum(["stable", "canary"])
          .default("stable")
          .describe("Release channel"),
      }),
      run: async ({ input, workspace }) => ({
        workflow: service.id,
        release: input.release,
        channel: input.channel,
        workspace: workspace.name,
        packageName: service.packageName,
        buildCommand: service.buildCommand,
      }),
    })
    .workspaceOperation("status", {
      title: "Status",
      description: "Return the prepared workspace metadata",
      run: async ({ workspace }) => ({
        workspace: workspace.name,
        serviceId: workspace.ctx.serviceId,
        packageName: workspace.ctx.packageName,
        artifactId: workspace.ctx.artifactId,
        ports: workspace.ctx.ports,
      }),
    })
    .workspaceOperation("dev", {
      title: "Dev",
      description: "Show the development command for this service",
      run: async ({ workspace }) => ({
        cwd: `${workspace.ctx.repoRoot}/${workspace.ctx.sourceDir}`,
        command: workspace.ctx.devCommand,
        ports: workspace.ctx.ports,
      }),
    })
    .workspaceOperation("test", {
      title: "Test",
      description: "Show the test command for this service",
      input: z.object({
        pattern: z
          .string()
          .optional()
          .describe("Optional test name or file pattern"),
      }),
      run: async ({ input, workspace }) => {
        const pattern =
          typeof input.pattern === "string" && input.pattern.length > 0
            ? input.pattern
            : undefined;

        return {
          cwd: `${workspace.ctx.repoRoot}/${workspace.ctx.sourceDir}`,
          command: pattern
            ? `${workspace.ctx.testCommand} -- ${pattern}`
            : workspace.ctx.testCommand,
        };
      },
    });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
