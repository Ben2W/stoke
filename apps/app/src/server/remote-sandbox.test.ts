import { describe, expect, test } from "bun:test";
import type { ManagedProject, ProjectStateResponse } from "@usestoke/managed";
import { runRemoteSandbox } from "./remote-sandbox.ts";

const project: ManagedProject = {
  id: "f95df42b-48da-4a02-926b-60def0ee77cf",
  slug: "ben2w-stoke-example",
  name: "stoke-example",
  source: { kind: "github", owner: "ben2w", repository: "stoke-example" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const state: ProjectStateResponse = {
  revision: 3,
  snapshot: { version: 1, scopes: {} },
};

describe("persistent remote evaluator", () => {
  test("bootstraps once and reuses the evaluator and discovered workflow", async () => {
    const files = new Map<string, Buffer>();
    const commands: Array<{ cmd: string; args?: string[]; env?: Record<string, string> }> = [];
    let created = false;
    let sandboxName: string | undefined;
    const sandbox = {
      name: "stoke-evaluator-test",
      async writeFiles(input: Array<{ path: string; content: string | Buffer }>) {
        for (const file of input) files.set(file.path, Buffer.from(file.content));
      },
      async readFileToBuffer(input: { path: string }) {
        return files.get(input.path) ?? null;
      },
      async runCommand(command: { cmd: string; args?: string[]; env?: Record<string, string> }) {
        commands.push(command);
        const isDiscovery = command.cmd === "bun" && command.args?.includes("ls");
        const isPlan = command.cmd === "bun" && command.args?.includes("plan");
        const stdout = isDiscovery
          ? JSON.stringify({ workflows: [{ name: "stoke-example" }] })
          : isPlan
            ? JSON.stringify({ workflow: "stoke-example", nodeCount: 0, cachedNodeCount: 0, nodes: [] })
            : "";
        return {
          exitCode: 0,
          durationMs: 1,
          stdout: async () => stdout,
          stderr: async () => "",
        };
      },
    };
    const getOrCreate = async (input: any) => {
      sandboxName = input.name;
      if (!created) {
        created = true;
        await input.onCreate(sandbox);
      }
      return sandbox as any;
    };
    const run = () => runRemoteSandbox({
      project,
      request: { operation: "plan", origin: "dashboard" },
      state,
      producerSocketUrl: "wss://usestoke.dev/runs/test",
      revision: "e587a05a934ac7be12bf5233102939d4479f8625",
      sandboxToken: "sandbox-token",
    }, { getOrCreate });

    const first = await run();
    const second = await run();

    expect(first.result).toMatchObject({ workflow: "stoke-example" });
    expect(second.result).toMatchObject({ workflow: "stoke-example" });
    expect(sandboxName).toMatch(/^stoke-evaluator-[a-f0-9]{24}$/);
    expect(commands.filter((command) => command.args?.includes("bun@1.3.7"))).toHaveLength(1);
    expect(commands.filter((command) => command.cmd === "bun" && command.args?.[0] === "install")).toHaveLength(1);
    expect(commands.filter((command) => command.cmd === "bun" && command.args?.includes("ls"))).toHaveLength(1);
    expect(commands.filter((command) => command.cmd === "bun" && command.args?.includes("plan"))).toHaveLength(2);
    expect(commands.at(-1)?.env).toMatchObject({
      STOKE_RUNTIME_STATE_REVISION: "3",
      STOKE_WORKSPACE_ORIGIN: "dashboard",
    });
  });

  test("refreshes source and dependencies when the repository revision changes", async () => {
    const files = new Map<string, Buffer>();
    const commands: Array<{ cmd: string; args?: string[] }> = [];
    let created = false;
    const sandbox = {
      name: "stoke-evaluator-test",
      async writeFiles(input: Array<{ path: string; content: string | Buffer }>) {
        for (const file of input) files.set(file.path, Buffer.from(file.content));
      },
      async readFileToBuffer(input: { path: string }) {
        return files.get(input.path) ?? null;
      },
      async runCommand(command: { cmd: string; args?: string[] }) {
        commands.push(command);
        const stdout = command.cmd === "bun" && command.args?.includes("plan")
          ? JSON.stringify({ workflow: "stoke-example", nodeCount: 0, cachedNodeCount: 0, nodes: [] })
          : "";
        return { exitCode: 0, durationMs: 1, stdout: async () => stdout, stderr: async () => "" };
      },
    };
    const getOrCreate = async (input: any) => {
      if (!created) {
        created = true;
        await input.onCreate(sandbox);
      }
      return sandbox as any;
    };
    const execute = (revision: string) => runRemoteSandbox({
      project,
      request: { operation: "plan", workflow: "stoke-example", origin: "dashboard" },
      state,
      producerSocketUrl: "wss://usestoke.dev/runs/test",
      revision,
      sandboxToken: "sandbox-token",
    }, { getOrCreate });

    await execute("revision-one");
    commands.length = 0;
    await execute("revision-two");

    expect(commands.map((command) => [command.cmd, command.args?.[0]])).toEqual([
      ["git", "fetch"],
      ["git", "checkout"],
      ["git", "clean"],
      ["bun", "install"],
      ["bun", "/tmp/stoke-cli.js"],
    ]);
  });

  test("uploads the complete Stoke failure log before returning an operation error", async () => {
    const logPath = ".stoke/logs/2026-08-05T10-00-00-000Z-run.log";
    const fullLog = `${"diagnostic output\n".repeat(500)}final failure detail`;
    const files = new Map<string, Buffer>([[logPath, Buffer.from(fullLog)]]);
    const stages: Array<Record<string, unknown>> = [];
    const sandbox = {
      name: "stoke-evaluator-test",
      async writeFiles(input: Array<{ path: string; content: string | Buffer }>) {
        for (const file of input) files.set(file.path, Buffer.from(file.content));
      },
      async readFileToBuffer(input: { path: string }) {
        return files.get(input.path) ?? null;
      },
      async runCommand(command: { cmd: string; args?: string[] }) {
        const isWorkspaceOperation = command.cmd === "bun" && command.args?.includes("run");
        return {
          exitCode: isWorkspaceOperation ? 1 : 0,
          durationMs: 8,
          stdout: async () => "",
          stderr: async () => isWorkspaceOperation ? `test failed\nfull log  ${logPath}` : "",
        };
      },
    };
    let created = false;
    const getOrCreate = async (input: any) => {
      if (!created) {
        created = true;
        await input.onCreate(sandbox);
      }
      return sandbox as any;
    };

    await expect(runRemoteSandbox({
      project,
      request: {
        operation: "run",
        workflow: "stoke-example",
        workspace: "demo",
        workspaceOperation: "test",
        input: {},
        origin: "dashboard",
      },
      state,
      producerSocketUrl: "wss://usestoke.dev/runs/test",
      revision: "revision-one",
      sandboxToken: "sandbox-token",
      onStage: (stage) => { stages.push(stage); },
    }, { getOrCreate })).rejects.toThrow("test failed");

    const logEvents = stages.filter((stage) => stage.type === "remote.log.output");
    expect(logEvents.length).toBeGreaterThan(1);
    expect(logEvents.map((event) => event.data).join("")).toBe(fullLog);
    expect(logEvents[0]).toMatchObject({ path: logPath, source: "stoke-runtime", stream: "log", sequence: 0 });
  });
});
