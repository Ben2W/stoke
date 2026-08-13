import { Sandbox } from "@vercel/sandbox";
import {
  ProjectStateResponseSchema,
  type ProjectStateResponse,
  type ManagedProject,
  type RemoteExecutionRequest,
} from "@usestoke/managed";

const SANDBOX_TIMEOUT_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 4 * 60_000;
const MAX_ERROR_OUTPUT_LENGTH = 4_000;
const MAX_FAILURE_LOG_LENGTH = 256_000;
const FAILURE_LOG_CHUNK_LENGTH = 6_000;
const STATE_FILE = "/tmp/stoke-managed-state.json";
const SANDBOX_TOKEN_FILE = "/tmp/stoke-sandbox-token";
const STOKE_CLI_PATH = "/tmp/stoke-cli.js";
const STOKE_RUNTIME_PATH = "/tmp/stoke-runtime.js";

export type RemoteSandboxStage =
  | {
    type: "remote.sandbox.created" | "remote.command.started" | "remote.command.completed";
    sandboxName?: string;
    command?: string;
    exitCode?: number;
    durationMs?: number;
  }
  | {
    type: "remote.log.output";
    data: string;
    path?: string;
    sequence: number;
    source: "stoke-runtime" | "command";
    stream: "log" | "stderr" | "stdout";
  };

export type RunRemoteSandboxInput = {
  project: ManagedProject;
  request: RemoteExecutionRequest;
  state: ProjectStateResponse;
  runId: string;
  revision: string;
  sandboxToken: string;
  onStage?: (stage: RemoteSandboxStage) => Promise<void> | void;
};

export type RemoteSandboxResult = {
  result: unknown;
  state: ProjectStateResponse;
};

type EvaluatorSandbox = Pick<
  Sandbox,
  "name" | "readFileToBuffer" | "runCommand" | "writeFiles"
> & AsyncDisposable;

export type RemoteSandboxDependencies = {
  create(input: Parameters<typeof Sandbox.create>[0]): Promise<EvaluatorSandbox>;
};

const defaultDependencies: RemoteSandboxDependencies = {
  create: (input) => Sandbox.create(input),
};

export async function runRemoteSandbox(
  input: RunRemoteSandboxInput,
  overrides: Partial<RemoteSandboxDependencies> = {},
): Promise<RemoteSandboxResult> {
  if (input.project.source.kind !== "github") {
    throw new Error("Remote execution currently requires a GitHub project source");
  }

  const dependencies = { ...defaultDependencies, ...overrides };
  const source = {
    type: "git" as const,
    url: `https://github.com/${input.project.source.owner}/${input.project.source.repository}.git`,
    depth: 1,
    revision: input.revision,
  };
  await using sandbox = await dependencies.create({
    source,
    runtime: "node24",
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false,
    tags: {
      service: "stoke",
      project: input.project.slug.slice(0, 80),
      role: "evaluator",
    },
  });
  await input.onStage?.({ type: "remote.sandbox.created", sandboxName: sandbox.name });
  await bootstrapEvaluator(sandbox, input);
  await sandbox.writeFiles([
    { path: STATE_FILE, content: JSON.stringify(input.state) },
    { path: SANDBOX_TOKEN_FILE, content: `${input.sandboxToken}\n` },
  ]);

  const baseCommandEnvironment = {
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    STOKE_STATE_FILE: STATE_FILE,
    STOKE_RUNTIME_BIN: STOKE_RUNTIME_PATH,
    STOKE_TOKEN: input.sandboxToken,
    STOKE_TOKEN_FILE: SANDBOX_TOKEN_FILE,
    STOKE_PROJECT_ID: input.project.id,
    STOKE_API_URL: controlPlaneUrl(),
    STOKE_SOURCE_REVISION: input.revision,
    STOKE_RUNTIME_STATE_REVISION: String(input.state.revision),
    ...(input.request.origin === "dashboard" ? { STOKE_WORKSPACE_ORIGIN: "dashboard" } : {}),
  };
  const commandEnvironment = { ...baseCommandEnvironment, STOKE_MANAGED_RUN_ID: input.runId };
  let workflow = input.request.workflow;
  if (!workflow) {
    const discovered = await runCommand(sandbox, input, "discover-workflow", {
      cmd: "bun",
      args: [STOKE_CLI_PATH, "ls", "--json"],
      // Workflow discovery is setup, not part of the requested run. Keeping it
      // out of the managed run transport prevents a duplicate task flow in the dashboard.
      env: baseCommandEnvironment,
    });
    workflow = singleWorkflowFromList(await discovered.stdout());
  }
  const result = await runCommand(sandbox, input, input.request.operation, {
    cmd: "bun",
    args: remoteCliArgs(input.request, workflow),
    env: commandEnvironment,
  });
  const stdout = await result.stdout();
  let parsedResult: unknown;
  try {
    parsedResult = JSON.parse(stdout);
  } catch {
    throw new Error(`Remote Stoke ${input.request.operation} returned invalid JSON`);
  }
  const stateBuffer = await sandbox.readFileToBuffer({ path: STATE_FILE });
  if (!stateBuffer) throw new Error("Remote Stoke execution did not return managed state");
  let state: ProjectStateResponse;
  try {
    state = ProjectStateResponseSchema.parse(JSON.parse(stateBuffer.toString("utf8")));
  } catch {
    throw new Error("Remote Stoke execution returned invalid managed state");
  }
  return { result: parsedResult, state };
}

async function bootstrapEvaluator(
  sandbox: EvaluatorSandbox,
  input: RunRemoteSandboxInput,
): Promise<void> {
  await runCommand(sandbox, input, "bootstrap-toolchain", {
    cmd: "npm",
    args: ["install", "--global", "bun@1.3.7"],
  });
  await loadRuntimeArtifacts(sandbox, input, evaluatorRuntimeRevision());
  await installDependencies(sandbox, input);
}

async function loadRuntimeArtifacts(
  sandbox: EvaluatorSandbox,
  input: RunRemoteSandboxInput,
  runtimeRevision: string,
): Promise<void> {
  const cacheBuster = encodeURIComponent(runtimeRevision);
  await runCommand(sandbox, input, "load-stoke-cli", {
    cmd: "curl",
    args: [
      "--fail",
      "--silent",
      "--show-error",
      `https://usestoke.dev/runtime/stoke-cli.js?revision=${cacheBuster}`,
      "-o",
      STOKE_CLI_PATH,
    ],
  });
  await runCommand(sandbox, input, "load-stoke-runtime", {
    cmd: "curl",
    args: [
      "--fail",
      "--silent",
      "--show-error",
      `https://usestoke.dev/runtime/stoke-runtime.js?revision=${cacheBuster}`,
      "-o",
      STOKE_RUNTIME_PATH,
    ],
  });
  await runCommand(sandbox, input, "prepare-stoke-runtime", {
    cmd: "chmod",
    args: ["700", STOKE_CLI_PATH, STOKE_RUNTIME_PATH],
  });
}

async function installDependencies(
  sandbox: EvaluatorSandbox,
  input: RunRemoteSandboxInput,
): Promise<void> {
  await runCommand(sandbox, input, "install-dependencies", {
    cmd: "bun",
    args: ["install"],
  });
}

export function evaluatorRuntimeRevision(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return environment.VERCEL_DEPLOYMENT_ID
    ?? environment.VERCEL_GIT_COMMIT_SHA
    ?? environment.VERCEL_URL
    ?? "development";
}

function controlPlaneUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://usestoke.dev";
}

type SandboxCommand = Parameters<Sandbox["runCommand"]>[0] & { cmd: string };

async function runCommand(
  sandbox: EvaluatorSandbox,
  input: RunRemoteSandboxInput,
  name: string,
  command: SandboxCommand,
) {
  await input.onStage?.({ type: "remote.command.started", command: name });
  const result = await sandbox.runCommand({ ...command, timeoutMs: COMMAND_TIMEOUT_MS });
  await input.onStage?.({
    type: "remote.command.completed",
    command: name,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  });
  if (result.exitCode !== 0) {
    const output = await commandOutput(result);
    await persistFailureLog(sandbox, input, output);
    throw commandFailure(name, result.exitCode, output);
  }
  return result;
}

function remoteCliArgs(request: RemoteExecutionRequest, workflow: string | undefined): string[] {
  if (request.operation === "create") {
    if (!workflow) throw new Error("Could not resolve a workflow for workspace creation");
    return [STOKE_CLI_PATH, "create", request.workspace, "--workflow", workflow, "--json"];
  }
  if (request.operation === "remove") {
    return [STOKE_CLI_PATH, "rm", request.workspace, "--workflow", request.workflow, "--yes", "--json"];
  }
  if (request.operation === "run") {
    return [
      STOKE_CLI_PATH,
      "run",
      request.workspace,
      request.workspaceOperation,
      "--workflow",
      request.workflow,
      ...operationInputArgs(request.input),
      "--json",
    ];
  }
  return [
    STOKE_CLI_PATH,
    request.operation,
    ...(workflow ? ["--workflow", workflow] : []),
    ...(request.operation === "apply" && request.dryRun ? ["--dry-run"] : []),
    "--json",
  ];
}

function operationInputArgs(input: Record<string, string | number | boolean>): string[] {
  return Object.entries(input).map(([name, value]) => {
    const flag = `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    return `${flag}=${String(value)}`;
  });
}

function singleWorkflowFromList(stdout: string): string {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("Could not discover the repository's Stoke workflows");
  }
  const workflows = isRecord(value) && Array.isArray(value.workflows)
    ? value.workflows.flatMap((workflow) =>
      isRecord(workflow) && typeof workflow.name === "string" ? [workflow.name] : []
    )
    : [];
  if (workflows.length === 1) return workflows[0]!;
  if (workflows.length === 0) throw new Error("The repository does not define a Stoke workflow");
  throw new Error(`Choose a workflow with --workflow. Available workflows: ${workflows.join(", ")}`);
}

async function commandOutput(
  result: { stderr(): Promise<string>; stdout(): Promise<string> },
): Promise<{ stderr: string; stdout: string }> {
  const [stderr, stdout] = await Promise.all([result.stderr(), result.stdout()]);
  return { stderr: stderr.trim(), stdout: stdout.trim() };
}

async function persistFailureLog(
  sandbox: EvaluatorSandbox,
  input: RunRemoteSandboxInput,
  output: { stderr: string; stdout: string },
): Promise<void> {
  const path = failureLogPath(`${output.stderr}\n${output.stdout}`);
  const buffer = path ? await sandbox.readFileToBuffer({ path }) : null;
  const data = (buffer?.toString("utf8") || output.stderr || output.stdout || "Command failed without output")
    .slice(0, MAX_FAILURE_LOG_LENGTH);
  const stream = buffer ? "log" : output.stderr ? "stderr" : "stdout";
  const source = buffer ? "stoke-runtime" : "command";
  for (let offset = 0, sequence = 0; offset < data.length; offset += FAILURE_LOG_CHUNK_LENGTH, sequence += 1) {
    await input.onStage?.({
      type: "remote.log.output",
      data: data.slice(offset, offset + FAILURE_LOG_CHUNK_LENGTH),
      ...(path ? { path } : {}),
      sequence,
      source,
      stream,
    });
  }
}

function failureLogPath(output: string): string | undefined {
  const value = output.match(/(?:^|\n)\s*full log\s+([^\r\n]+)/i)?.[1]?.trim();
  if (!value || !/^\.stoke\/logs\/[a-zA-Z0-9._-]+\.log$/.test(value)) return undefined;
  return value;
}

function commandFailure(
  name: string,
  exitCode: number,
  output: { stderr: string; stdout: string },
): Error {
  return new Error(
    `${name} failed with exit code ${exitCode}: ${truncateOutput(output.stderr || output.stdout || "no output")}`,
  );
}

function truncateOutput(value: string): string {
  if (value.length <= MAX_ERROR_OUTPUT_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_OUTPUT_LENGTH)}\n… output truncated`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
