import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";

export type RunTaskStatus = "cached" | "completed" | "failed" | "pending" | "running";

export type RunTaskOutput = {
  id: number;
  kind: "command" | "detail" | "log";
  stream?: string;
  text: string;
};

export type RunTask = {
  completedAt?: string;
  nodePath: string;
  output: RunTaskOutput[];
  upstreamRunIds: string[];
  runId?: string;
  startedAt?: string;
  status: RunTaskStatus;
};

export type RunTaskFlow = {
  cachedTaskCount: number;
  completedTaskCount: number;
  setup?: {
    status: "completed" | "failed" | "running";
  };
  tasks: RunTask[];
  workflowOutput: RunTaskOutput[];
};

export function projectRunTaskFlow(events: ManagedRunEvent[], run: ManagedRun): RunTaskFlow {
  const operationStart = findRemoteOperationStart(events, run.operation);
  const scopedEvents = operationStart >= 0 ? events.slice(operationStart + 1) : events;
  const remoteEvents = events.filter((event) => event.type.startsWith("remote."));
  const tasks = new Map<string, RunTask>();
  const workflowOutput: RunTaskOutput[] = [];

  for (const event of scopedEvents) {
    const nodePath = stringField(event.data.nodePath);
    switch (event.type) {
      case "node.started": {
        if (!nodePath) break;
        const task = getTask(tasks, nodePath);
        task.status = "running";
        task.startedAt ??= event.createdAt;
        break;
      }
      case "node.cached": {
        if (!nodePath) break;
        const task = getTask(tasks, nodePath);
        task.status = "cached";
        task.completedAt = event.createdAt;
        task.runId = stringField(event.data.runId);
        break;
      }
      case "node.completed": {
        if (!nodePath) break;
        const task = getTask(tasks, nodePath);
        task.status = "completed";
        task.completedAt = event.createdAt;
        task.runId = stringField(event.data.runId);
        break;
      }
      case "workspace.operation.started": {
        const workspaceName = stringField(event.data.workspaceName);
        const operationId = stringField(event.data.operationId);
        if (!workspaceName || !operationId) break;
        const task = getTask(tasks, `workspace.${workspaceName}.${operationId}`);
        task.status = "running";
        task.startedAt ??= event.createdAt;
        break;
      }
      case "workspace.operation.completed": {
        const workspaceName = stringField(event.data.workspaceName);
        const operationId = stringField(event.data.operationId);
        if (!workspaceName || !operationId) break;
        const task = getTask(tasks, `workspace.${workspaceName}.${operationId}`);
        task.status = "completed";
        task.completedAt = event.createdAt;
        break;
      }
      case "plan.nodes": {
        const nodes = Array.isArray(event.data.nodes) ? event.data.nodes : [];
        for (const value of nodes) {
          if (!isRecord(value)) continue;
          const path = stringField(value.path);
          if (!path || (value.status !== "cached" && value.status !== "pending")) continue;
          const task = getTask(tasks, path);
          if (task.status === "running") task.status = value.status;
          if (typeof value.runId === "string") task.runId = value.runId;
          if (Array.isArray(value.upstreamRunIds) && value.upstreamRunIds.every((id) => typeof id === "string")) {
            task.upstreamRunIds = value.upstreamRunIds;
          }
        }
        break;
      }
      case "command.started": {
        const command = stringField(event.data.command) ?? stringField(event.data.commandName);
        if (command) appendOutput(tasks, workflowOutput, nodePath, event, "command", `$ ${command}`);
        break;
      }
      case "command.output":
      case "log.output": {
        const data = stringField(event.data.data, true);
        if (data) {
          appendOutput(
            tasks,
            workflowOutput,
            nodePath,
            event,
            event.type === "command.output" ? "command" : "log",
            data,
            stringField(event.data.stream),
          );
        }
        break;
      }
      case "command.completed": {
        const exitCode = numberField(event.data.exitCode) ?? 0;
        if (exitCode !== 0) {
          const command = stringField(event.data.commandName) ?? "command";
          appendOutput(tasks, workflowOutput, nodePath, event, "command", `${command} exited ${exitCode}`, "error");
        }
        break;
      }
      case "vm.created": {
        const vmId = stringField(event.data.vmId) ?? "ready";
        const snapshotId = stringField(event.data.fromSnapshotId);
        appendOutput(tasks, workflowOutput, nodePath, event, "detail", snapshotId ? `vm ${vmId} from ${snapshotId}` : `vm ${vmId} created`);
        break;
      }
      case "artifact.created": {
        const provider = stringField(event.data.providerId);
        const kind = stringField(event.data.kind) ?? "artifact";
        appendOutput(tasks, workflowOutput, nodePath, event, "detail", `+ ${provider ? `${provider}:` : ""}${kind}`);
        break;
      }
      case "host.capability.request": {
        const capability = stringField(event.data.capability);
        if (capability === "browser.open") {
          const params = isRecord(event.data.params) ? event.data.params : undefined;
          const displayName = params ? stringField(params.displayName) : undefined;
          appendOutput(tasks, workflowOutput, nodePath, event, "detail", `${displayName ?? "Development preview"} ready`);
        }
        if (capability === "ssh") {
          appendOutput(tasks, workflowOutput, nodePath, event, "detail", "Opening SSH session…");
        }
        break;
      }
    }
  }

  const projectedTasks = [...tasks.values()];
  if (run.status === "failed" || run.status === "orphaned") {
    for (let index = projectedTasks.length - 1; index >= 0; index -= 1) {
      const task = projectedTasks[index]!;
      if (task.status !== "running") continue;
      task.status = "failed";
      break;
    }
  }

  return {
    cachedTaskCount: projectedTasks.filter((task) => task.status === "cached").length,
    completedTaskCount: projectedTasks.filter((task) => task.status === "completed" || task.status === "cached").length,
    setup: remoteEvents.length > 0
      ? {
        status: run.status === "failed" && operationStart < 0
          ? "failed"
          : operationStart >= 0 || run.status !== "running"
            ? "completed"
            : "running",
      }
      : undefined,
    tasks: projectedTasks,
    workflowOutput,
  };
}

function findRemoteOperationStart(events: ManagedRunEvent[], operation: ManagedRun["operation"]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "remote.command.started" && event.data.command === operation) return index;
  }
  return -1;
}

function getTask(tasks: Map<string, RunTask>, nodePath: string): RunTask {
  const current = tasks.get(nodePath);
  if (current) return current;
  const task: RunTask = { nodePath, output: [], status: "running", upstreamRunIds: [] };
  tasks.set(nodePath, task);
  return task;
}

function appendOutput(
  tasks: Map<string, RunTask>,
  workflowOutput: RunTaskOutput[],
  nodePath: string | undefined,
  event: ManagedRunEvent,
  kind: RunTaskOutput["kind"],
  text: string,
  stream?: string,
): void {
  const output = { id: event.id, kind, stream, text };
  if (nodePath) getTask(tasks, nodePath).output.push(output);
  else workflowOutput.push(output);
}

function stringField(value: unknown, allowWhitespace = false): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!allowWhitespace && !value.trim()) return undefined;
  return value;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
