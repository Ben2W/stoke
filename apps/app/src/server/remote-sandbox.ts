import { Sandbox } from "@vercel/sandbox";
import {
  ProjectStateResponseSchema,
  type ProjectStateResponse,
  type ManagedProject,
  type RemoteExecutionRequest,
} from "@stoke/managed";

const SANDBOX_TIMEOUT_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 4 * 60_000;
const MAX_ERROR_OUTPUT_LENGTH = 4_000;
const STATE_FILE = "/tmp/stoke-managed-state.json";
const STOKE_CLI_PATH = "/tmp/stoke-cli.js";
const STOKE_RUNTIME_PATH = "/tmp/stoke-runtime.js";

export type RemoteSandboxStage = {
  type: "remote.sandbox.created" | "remote.command.started" | "remote.command.completed";
  sandboxName?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
};

export type RunRemoteSandboxInput = {
  project: ManagedProject;
  request: RemoteExecutionRequest;
  state: ProjectStateResponse;
  producerSocketUrl: string;
  revision: string;
  onStage?: (stage: RemoteSandboxStage) => Promise<void> | void;
};

export type RemoteSandboxResult = {
  result: unknown;
  state: ProjectStateResponse;
};

export async function runRemoteSandbox(input: RunRemoteSandboxInput): Promise<RemoteSandboxResult> {
  if (input.project.source.kind !== "github") {
    throw new Error("Remote execution currently requires a GitHub project source");
  }

  const source = {
    type: "git" as const,
    url: `https://github.com/${input.project.source.owner}/${input.project.source.repository}.git`,
    depth: 1,
    revision: input.revision,
  };
  await using sandbox = await Sandbox.create({
    source,
    runtime: "node24",
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false,
    tags: {
      service: "stoke",
      project: input.project.slug.slice(0, 80),
    },
  });
  await input.onStage?.({ type: "remote.sandbox.created", sandboxName: sandbox.name });
  await sandbox.writeFiles([{ path: STATE_FILE, content: JSON.stringify(input.state) }]);

  await runCommand(sandbox, input, "bootstrap-toolchain", {
    cmd: "npm",
    args: ["install", "--global", "bun@1.3.7"],
  });
  await runCommand(sandbox, input, "load-stoke-cli", {
    cmd: "curl",
    args: ["--fail", "--silent", "--show-error", "https://usestoke.dev/runtime/stoke-cli.js", "-o", STOKE_CLI_PATH],
  });
  await runCommand(sandbox, input, "load-stoke-runtime", {
    cmd: "curl",
    args: ["--fail", "--silent", "--show-error", "https://usestoke.dev/runtime/stoke-runtime.js", "-o", STOKE_RUNTIME_PATH],
  });
  await runCommand(sandbox, input, "prepare-stoke-runtime", {
    cmd: "chmod",
    args: ["700", STOKE_CLI_PATH, STOKE_RUNTIME_PATH],
  });
  await runCommand(sandbox, input, "install-dependencies", {
    cmd: "bun",
    args: ["install"],
  });

  const baseCommandEnvironment = {
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    STOKE_STATE_FILE: STATE_FILE,
    STOKE_RUNTIME_BIN: STOKE_RUNTIME_PATH,
    ...(input.request.origin === "dashboard" ? { STOKE_WORKSPACE_ORIGIN: "dashboard" } : {}),
  };
  const commandEnvironment = {
    ...baseCommandEnvironment,
    STOKE_MANAGED_RUN_SOCKET_URL: input.producerSocketUrl,
  };
  let workflow = input.request.workflow;
  if (!workflow) {
    const discovered = await runCommand(sandbox, input, "discover-workflow", {
      cmd: "bun",
      args: [STOKE_CLI_PATH, "ls", "--json"],
      // Workflow discovery is setup, not part of the requested run. Keeping it
      // off the managed socket prevents a duplicate task flow in the dashboard.
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

type SandboxCommand = Parameters<Sandbox["runCommand"]>[0] & { cmd: string };

async function runCommand(
  sandbox: Sandbox,
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
  if (result.exitCode !== 0) throw await commandFailure(name, result);
  return result;
}

function remoteCliArgs(request: RemoteExecutionRequest, workflow: string | undefined): string[] {
  return [
    STOKE_CLI_PATH,
    request.operation,
    ...(workflow ? ["--workflow", workflow] : []),
    ...(request.operation === "apply" && request.dryRun ? ["--dry-run"] : []),
    "--json",
  ];
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

async function commandFailure(
  name: string,
  result: { exitCode: number; stderr(): Promise<string>; stdout(): Promise<string> },
): Promise<Error> {
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  return new Error(
    `${name} failed with exit code ${result.exitCode}: ${truncateOutput(stderr || stdout || "no output")}`,
  );
}

function truncateOutput(value: string): string {
  if (value.length <= MAX_ERROR_OUTPUT_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_OUTPUT_LENGTH)}\n… output truncated`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
