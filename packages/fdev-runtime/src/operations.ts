import {
  createDevMachineEngine,
  type DevMachineEngine,
} from "@freestyle-sh/fdev-engine";
import { z } from "zod";
import {
  HostCommandResultSchema,
  objectSchema,
  type JsonSchema,
  type RuntimeOperation,
} from "./protocol.ts";
import {
  completeRun,
  emitRunEvent,
  failRun,
  requestHost,
  type RunRecord,
  type RunStore,
} from "./runs.ts";

export type EngineLoadOptions = {
  projectDir: string;
  configPath: string;
  statePath?: string;
};

const OptionalWorkflowSchema = z.string().trim().min(1).optional();

const PlanInputSchema = z.object({
  workflow: OptionalWorkflowSchema,
}).strict();

const ApplyInputSchema = z.object({
  workflow: OptionalWorkflowSchema,
  dryRun: z.boolean().optional().default(false),
}).strict();

const ForkInputSchema = z.object({
  workflow: OptionalWorkflowSchema,
  name: z.string().trim().min(1),
}).strict();

const SshInputSchema = z.object({
  workflow: OptionalWorkflowSchema,
  workspaceOrVmId: z.string().trim().min(1),
  user: z.string().trim().min(1).optional(),
}).strict();

const SnapshotInputSchema = z.object({
  workflow: OptionalWorkflowSchema,
  workspace: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
}).strict();

const RemoveInputSchema = z.object({
  workflow: OptionalWorkflowSchema,
  workspace: z.string().trim().min(1),
}).strict();

export async function loadEngine(input: EngineLoadOptions): Promise<DevMachineEngine> {
  const engine = await createDevMachineEngine({
    projectDir: input.projectDir,
    configPath: input.configPath,
    statePath: input.statePath,
  });
  await engine.load();
  return engine;
}

export function runOperation(run: RunRecord, store: RunStore, options: EngineLoadOptions): void {
  executeOperation(run, store, options).catch((error) => failRun(run, error));
}

async function executeOperation(run: RunRecord, store: RunStore, options: EngineLoadOptions): Promise<void> {
  const engine = await createDevMachineEngine({
    projectDir: options.projectDir,
    configPath: options.configPath,
    statePath: options.statePath,
    interaction: {
      present: async (request) => {
        await requestHost(store, run, "open.external", {
          target: request.url,
          kind: "url",
          label: request.title,
        });
      },
    },
    local: {
      open: async (target) => {
        await requestHost(store, run, "open.external", { target, kind: guessExternalKind(target) });
      },
      command: async (command) => {
        const result = await requestHost(store, run, "host.command.run", command);
        return HostCommandResultSchema.parse(result);
      },
    },
  });
  engine.onEvent((event) => emitRunEvent(run, event));
  await engine.load();

  let result: unknown;

  switch (run.operation) {
    case "plan": {
      const input = PlanInputSchema.parse(run.input);
      result = await engine.plan({ workflow: input.workflow });
      break;
    }
    case "apply": {
      const input = ApplyInputSchema.parse(run.input);
      result = input.dryRun
        ? { dryRun: true, plan: await engine.plan({ workflow: input.workflow }) }
        : await engine.apply({ workflow: input.workflow });
      break;
    }
    case "fork": {
      const input = ForkInputSchema.parse(run.input);
      result = await engine.fork({ workflow: input.workflow, name: input.name });
      break;
    }
    case "ssh": {
      const input = SshInputSchema.parse(run.input);
      result = await engine.attachTerminal({
        workflow: input.workflow,
        workspaceOrVmId: input.workspaceOrVmId,
        printOnly: true,
        user: input.user,
      });
      break;
    }
    case "snapshot": {
      const input = SnapshotInputSchema.parse(run.input);
      result = await engine.snapshotWorkspace({
        workflow: input.workflow,
        workspace: input.workspace,
        label: input.label,
      });
      break;
    }
    case "rm": {
      const input = RemoveInputSchema.parse(run.input);
      result = await engine.deleteWorkspace({ workflow: input.workflow, workspace: input.workspace });
      break;
    }
    default:
      throw new Error(`Unknown operation ${run.operation}`);
  }

  completeRun(run, result);
}

export function operationsFor(engine: DevMachineEngine): RuntimeOperation[] {
  const workflows = engine.listWorkflows().map((workflow) => workflow.name);
  const workflowProperty = workflowJsonSchema(workflows);

  return [
    {
      id: "plan",
      kind: "command",
      title: "Plan",
      description: "Show cached and pending steps",
      inputSchema: objectSchema({ workflow: workflowProperty }),
    },
    {
      id: "apply",
      kind: "command",
      title: "Apply",
      description: "Resolve the workflow, running pending nodes",
      inputSchema: objectSchema({
        workflow: workflowProperty,
        dryRun: { type: "boolean", default: false },
      }),
    },
    {
      id: "fork",
      kind: "command",
      title: "Fork",
      description: "Create a workspace from the resolved workflow artifact",
      inputSchema: objectSchema({
        workflow: workflowProperty,
        name: { type: "string", minLength: 1 },
      }, ["name"]),
    },
    {
      id: "ssh",
      kind: "command",
      title: "SSH",
      description: "Get an SSH command for a workspace or VM",
      inputSchema: objectSchema({
        workflow: workflowProperty,
        workspaceOrVmId: { type: "string", minLength: 1 },
        user: { type: "string" },
      }, ["workspaceOrVmId"]),
    },
    {
      id: "snapshot",
      kind: "command",
      title: "Snapshot",
      description: "Capture a snapshot from a workspace VM",
      inputSchema: objectSchema({
        workflow: workflowProperty,
        workspace: { type: "string", minLength: 1 },
        label: { type: "string" },
      }, ["workspace"]),
    },
    {
      id: "rm",
      kind: "command",
      title: "Remove",
      description: "Delete a workspace VM and remove it from state",
      inputSchema: objectSchema({
        workflow: workflowProperty,
        workspace: { type: "string", minLength: 1 },
      }, ["workspace"]),
    },
  ];
}

function workflowJsonSchema(workflows: string[]): JsonSchema {
  return workflows.length > 0
    ? { type: "string", enum: workflows }
    : { type: "string" };
}

function guessExternalKind(target: string): "url" | "file" | "unknown" {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return "url";
  if (target.startsWith("/")) return "file";
  return "unknown";
}
