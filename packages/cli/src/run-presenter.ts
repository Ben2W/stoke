import chalk from "chalk";
import { createLogUpdate } from "log-update";
import logSymbols from "log-symbols";
import ora from "ora";

export type RunPresenter = {
  render(event: { type: string; [key: string]: unknown }): void;
  pause(): void;
  resume(): void;
  close(): void;
};

type StepStatus = "running" | "done" | "cached" | "failed";

type RunStep = {
  index: number;
  path: string;
  status: StepStatus;
  detail: string;
  logs: string[];
};

export function createRunPresenter(operation: string): RunPresenter | undefined {
  if (!canUsePresenter()) return undefined;

  const log = createLogUpdate(normalizedStderr(), {
    defaultHeight: 24,
    defaultWidth: 80,
  });
  const spinner = ora({
    color: "cyan",
    discardStdin: false,
    isEnabled: true,
    spinner: "dots",
    stream: process.stderr,
  });
  const steps: RunStep[] = [];
  const stepsByPath = new Map<string, RunStep>();
  let totalSteps = 0;
  let workflow = "";
  let phase = "Starting runtime operation";
  let activePath: string | undefined;
  let finalStatus: "running" | "completed" | "failed" = "running";
  let closed = false;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = () => {
    if (closed || paused) return;
    log(renderTimeline({
      activePath,
      finalStatus,
      operation,
      phase,
      spinnerFrame: spinner.frame().trimEnd(),
      steps,
      totalSteps,
      workflow,
    }));
  };

  const startTimer = () => {
    timer ??= setInterval(refresh, spinner.interval);
    timer.unref?.();
  };
  const stopTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };
  startTimer();
  refresh();

  return {
    render(event) {
      if (closed) return;
      switch (event.type) {
        case "definition.loaded":
          workflow = String(event.workflow ?? "workflow");
          phase = `Loaded ${workflow}`;
          break;
        case "plan.created":
          workflow = String(event.workflow ?? (workflow || "workflow"));
          totalSteps = numberField(event.nodeCount) ?? totalSteps;
          phase = `Planned ${workflow}`;
          break;
        case "node.cached":
          markStep(stepFor(steps, stepsByPath, event.nodePath), "cached", compactId(event.runId));
          break;
        case "node.started":
          activePath = stringField(event.nodePath);
          markStep(stepFor(steps, stepsByPath, event.nodePath), "running", "loading");
          phase = `Running ${activePath ?? "step"}`;
          break;
        case "node.completed": {
          const step = stepFor(steps, stepsByPath, event.nodePath);
          markStep(step, "done", compactId(event.runId));
          if (activePath === step.path) activePath = undefined;
          phase = `Completed ${step.path}`;
          break;
        }
        case "vm.created":
          setActiveDetail(stepsByPath, activePath, event.fromSnapshotId
            ? `VM ${String(event.vmId ?? "")} from ${String(event.fromSnapshotId)}`
            : `VM ${String(event.vmId ?? "")} created`);
          break;
        case "command.started": {
          const step = stepFor(steps, stepsByPath, event.nodePath ?? activePath);
          step.status = "running";
          activePath = step.path;
          step.detail = String(event.command ?? event.commandName ?? "command");
          phase = `Command ${String(event.commandName ?? "command")}`;
          break;
        }
        case "command.output": {
          const step = stepFor(steps, stepsByPath, event.nodePath ?? activePath);
          activePath = step.path;
          appendLog(step.logs, `[${String(event.stream ?? "log")}] ${String(event.data ?? "")}`);
          break;
        }
        case "command.completed":
          setActiveDetail(
            stepsByPath,
            stringField(event.nodePath) ?? activePath,
            `Command ${String(event.commandName ?? "")} exited ${String(event.exitCode ?? 0)}`,
          );
          break;
        case "log.output": {
          const step = stepFor(steps, stepsByPath, event.nodePath ?? activePath);
          activePath = step.status === "running" ? step.path : activePath;
          appendLog(step.logs, `[${String(event.label ?? event.stream ?? "log")}] ${String(event.data ?? "")}`);
          break;
        }
        case "interaction.awaiting_user":
          phase = `Waiting for ${String(event.title ?? "user interaction")}`;
          setActiveDetail(stepsByPath, stringField(event.nodePath) ?? activePath, String(event.url ?? ""));
          break;
        case "interaction.completed":
          phase = `Completed ${String(event.title ?? "interaction")}`;
          break;
        case "artifact.created":
          setActiveDetail(
            stepsByPath,
            stringField(event.nodePath) ?? activePath,
            `Created ${String(event.kind ?? "artifact")}`,
          );
          break;
        case "workspace.ready":
          phase = `Workspace ${String(event.resourceId ?? event.workspaceId ?? "ready")} ready`;
          break;
        case "run.completed":
          finalStatus = "completed";
          phase = "Completed";
          collapseActiveStep(stepsByPath, activePath);
          activePath = undefined;
          break;
        case "run.failed":
          finalStatus = "failed";
          phase = isRecord(event.error) && typeof event.error.message === "string"
            ? event.error.message
            : "Run failed";
          activePath = failActiveStep(steps, stepsByPath, activePath, phase);
          break;
      }
      refresh();
    },
    pause() {
      if (closed || paused) return;
      log(renderTimeline({
        activePath,
        finalStatus,
        operation,
        phase,
        spinnerFrame: spinner.frame().trimEnd(),
        steps,
        totalSteps,
        workflow,
      }));
      paused = true;
      stopTimer();
      log.done();
    },
    resume() {
      if (closed || !paused) return;
      paused = false;
      startTimer();
      refresh();
    },
    close() {
      if (closed) return;
      if (paused) {
        paused = false;
      }
      refresh();
      closed = true;
      stopTimer();
      log.done();
    },
  };
}

function normalizedStderr(): NodeJS.WriteStream {
  const stream = Object.create(process.stderr) as NodeJS.WriteStream;
  Object.defineProperty(stream, "columns", {
    get: () => process.stderr.columns || 80,
  });
  Object.defineProperty(stream, "rows", {
    get: () => process.stderr.rows || 24,
  });
  stream.write = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;
  return stream;
}

function canUsePresenter(): boolean {
  return Boolean(
    process.env.RIGKIT_RENDER !== "0" &&
      process.stderr.isTTY,
  );
}

function renderTimeline(input: {
  activePath: string | undefined;
  finalStatus: "running" | "completed" | "failed";
  operation: string;
  phase: string;
  spinnerFrame: string;
  steps: RunStep[];
  totalSteps: number;
  workflow: string;
}): string {
  const done = input.steps.filter((step) => step.status === "done" || step.status === "cached").length;
  const total = input.totalSteps || input.steps.length;
  const progress = total > 0 ? `${done}/${total} steps` : `${input.steps.length} steps`;
  const title = input.workflow ? `${input.operation} ${input.workflow}` : input.operation;
  const lines = [
    `${statusPrefix(input.finalStatus, input.spinnerFrame)} ${chalk.bold(title)} ${chalk.dim(input.phase)} ${chalk.dim(`(${progress})`)}`,
    "",
    ...timelineLines(input),
  ];
  return lines.join("\n");
}

function timelineLines(input: {
  activePath: string | undefined;
  spinnerFrame: string;
  steps: RunStep[];
}): string[] {
  const visible = input.steps.length > 8 ? input.steps.slice(-8) : input.steps;
  const lines: string[] = [];
  if (visible.length < input.steps.length) {
    lines.push(chalk.dim(`... ${input.steps.length - visible.length} earlier steps`));
  }

  const active = input.activePath ? input.steps.find((step) => step.path === input.activePath) : undefined;
  for (const step of visible) {
    lines.push(stepLine(step, input.spinnerFrame));
    if (step.path === active?.path && (step.status === "running" || step.status === "failed")) {
      if (step.detail) lines.push(chalk.dim(`     ${clip(step.detail, 100)}`));
      for (const line of step.logs.slice(-4)) lines.push(chalk.dim(`     ${clip(line, 100)}`));
    }
  }

  return lines.length > 0 ? lines : [chalk.dim("waiting for runtime events")];
}

function stepLine(step: RunStep, spinnerFrame: string): string {
  const index = String(step.index).padStart(2, " ");
  switch (step.status) {
    case "running":
      return `${chalk.dim(index)} ${spinnerFrame} ${chalk.bold(step.path)}`;
    case "cached":
      return `${chalk.dim(index)} ${logSymbols.success} ${chalk.dim(step.path)}${step.detail ? chalk.dim(` cached ${step.detail}`) : ""}`;
    case "done":
      return `${chalk.dim(index)} ${logSymbols.success} ${chalk.dim(step.path)}${step.detail ? chalk.dim(` ${step.detail}`) : ""}`;
    case "failed":
      return `${chalk.dim(index)} ${logSymbols.error} ${chalk.bold(step.path)}`;
  }
}

function statusPrefix(status: "running" | "completed" | "failed", spinnerFrame: string): string {
  if (status === "completed") return logSymbols.success;
  if (status === "failed") return logSymbols.error;
  return spinnerFrame;
}

function stepFor(
  steps: RunStep[],
  stepsByPath: Map<string, RunStep>,
  rawPath: unknown,
): RunStep {
  const path = typeof rawPath === "string" && rawPath.length > 0 ? rawPath : "runtime";
  const existing = stepsByPath.get(path);
  if (existing) return existing;
  const step: RunStep = {
    index: steps.length + 1,
    path,
    status: "running",
    detail: "loading",
    logs: [],
  };
  steps.push(step);
  stepsByPath.set(path, step);
  return step;
}

function markStep(step: RunStep, status: StepStatus, detail: string): void {
  step.status = status;
  step.detail = detail;
  if (status === "done" || status === "cached") {
    step.logs = [];
  }
}

function setActiveDetail(stepsByPath: Map<string, RunStep>, path: string | undefined, detail: string): void {
  if (!path) return;
  const step = stepsByPath.get(path);
  if (!step) return;
  step.detail = detail;
}

function collapseActiveStep(stepsByPath: Map<string, RunStep>, path: string | undefined): void {
  if (!path) return;
  const step = stepsByPath.get(path);
  if (step?.status === "running") markStep(step, "done", "completed");
}

function failActiveStep(
  steps: RunStep[],
  stepsByPath: Map<string, RunStep>,
  path: string | undefined,
  message: string,
): string | undefined {
  const step = path ? stepsByPath.get(path) : lastStepToFail(steps);
  if (!step) return undefined;
  markStep(step, "failed", message);
  return step.path;
}

function lastStepToFail(steps: RunStep[]): RunStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (step.status === "running") return step;
  }
  return steps[steps.length - 1];
}

function appendLog(lines: string[], value: string): void {
  for (const line of value.replace(/\r/g, "").split("\n")) {
    if (line.length === 0) continue;
    lines.push(line);
  }
  if (lines.length > 200) lines.splice(0, lines.length - 200);
}

function compactId(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 8) : "";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}
