import { describe, expect, test } from "bun:test";
import type { ExecOptions, ExecOutputChunk, ExecResult } from "@rigkit/sdk";
import type {
  BaseDevMachineProvider,
  ProviderRuntimeContext,
  SshConnection,
  VmHandle,
  WorkflowEvent,
} from "@rigkit/engine";
import { createFreestyleWorkflowController, wrapCommand } from "./provider.ts";
import type { FreestyleWorkspaceContext } from "./provider.ts";

describe("Freestyle provider command wrapper", () => {
  test("sets a root HOME fallback for exec commands", () => {
    expect(wrapCommand("printf '%s\n' \"$HOME\"")).toContain("export HOME=${HOME:-/root}");
  });

  test("allows callers to override HOME explicitly", () => {
    const wrapped = wrapCommand("pwd", {
      env: { HOME: "/workspace/home" },
    });

    expect(wrapped).toContain("export HOME=${HOME:-/root}");
    expect(wrapped).toContain("export HOME='\\''/workspace/home'\\''");
  });

  test("streams VM command output through run events without replaying buffered output", async () => {
    const chunks: ExecOutputChunk[] = [];
    const events: WorkflowEvent[] = [];
    const provider = new StreamingProvider();
    const controller = createFreestyleWorkflowController(provider);
    const runtime = await controller.runtime(providerContext(events));
    const vm = runtime.vms.fromWorkspace({ resourceId: "vm-stream" });

    const result = await vm.exec("printf ready", {
      name: "stream command",
      onOutput: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(result.stdout).toBe("ready\n");
    expect(chunks).toEqual([{ stream: "stdout", data: "ready\n" }]);
    expect(events).toEqual([
      {
        type: "command.started",
        nodePath: "workflow.step",
        commandName: "stream command",
        command: "printf ready",
      },
      {
        type: "command.output",
        nodePath: "workflow.step",
        commandName: "stream command",
        stream: "stdout",
        data: "ready\n",
      },
      {
        type: "command.completed",
        nodePath: "workflow.step",
        commandName: "stream command",
        exitCode: 0,
      },
    ]);
  });
});

const sshConnection: SshConnection = {
  kind: "ssh",
  host: "localhost",
  username: "root",
  auth: { type: "token", token: "token" },
  command: "ssh vm-stream",
};

class StreamingProvider implements BaseDevMachineProvider<FreestyleWorkspaceContext> {
  readonly providerId = "freestyle";

  async createVm(): Promise<VmHandle> {
    return { vmId: "vm-stream" };
  }

  async createVmFromSnapshot(): Promise<VmHandle> {
    return { vmId: "vm-stream" };
  }

  async exec(_vm: VmHandle, _command: string, options?: ExecOptions): Promise<ExecResult> {
    await options?.onOutput?.({ stream: "stdout", data: "ready\n" });
    return { stdout: "ready\n", stderr: "", exitCode: 0, ok: true };
  }

  async readFile(): Promise<string> {
    return "";
  }

  async writeFile(): Promise<void> {}

  async snapshot(): Promise<{ snapshotId: string; sourceVmId: string }> {
    return { snapshotId: "snap-stream", sourceVmId: "vm-stream" };
  }

  async ssh(): Promise<SshConnection> {
    return sshConnection;
  }

  async workspaceContext(): Promise<FreestyleWorkspaceContext> {
    return {
      ssh: sshConnection,
      host: sshConnection.host,
      username: sshConnection.username,
      vscodeAuthority: "root@localhost",
    };
  }

  async deleteVm(): Promise<void> {}
}

function providerContext(events: WorkflowEvent[]): ProviderRuntimeContext {
  return {
    workflow: "workflow",
    nodePath: "workflow.step",
    emit: (event) => {
      events.push(event);
    },
    interaction: {
      present: async () => {
        throw new Error("unexpected interaction");
      },
    },
    local: {
      open: async () => {},
    },
    metadata: () => {},
  };
}
