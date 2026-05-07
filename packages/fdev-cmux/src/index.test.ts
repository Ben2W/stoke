import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CmuxCommandError,
  createCmuxClient,
  formatShellCommand,
  isInsideCmuxTerminal,
  parseCmuxHandle,
  parseOptionalCmuxHandle,
  type CmuxRpcParams,
  type CmuxRpcResult,
} from "./index.ts";

describe("cmux sdk", () => {
  test("parses workspace refs from cmux text output", () => {
    expect(parseCmuxHandle("OK workspace:3\n", "workspace")).toBe("workspace:3");
  });

  test("parses optional typed refs without stealing unrelated UUIDs", () => {
    const output = "OK workspace=workspace:2 pane=pane:4 surface=surface:5";
    expect(parseOptionalCmuxHandle(output, "workspace")).toBe("workspace:2");
    expect(parseOptionalCmuxHandle(output, "pane")).toBe("pane:4");
    expect(parseOptionalCmuxHandle(output, "surface")).toBe("surface:5");
    expect(parseOptionalCmuxHandle("OK workspace=00000000-0000-0000-0000-000000000001", "pane")).toBeUndefined();
  });

  test("creates a workspace with command text", async () => {
    const calls: Array<{ method: string; params: CmuxRpcParams }> = [];
    const rpcRunner = (method: string, params: CmuxRpcParams): CmuxRpcResult => {
      calls.push({ method, params });
      if (method === "workspace.create") {
        return {
          workspace_id: "00000000-0000-0000-0000-000000000007",
          workspace_ref: "workspace:7",
        };
      }
      return {};
    };

    const cmux = createCmuxClient({ printCommands: false, rpcRunner });
    const workspace = await cmux.newWorkspace({
      name: "cmux-playground",
      command: "echo hello world",
      focus: true,
    });

    expect(workspace.handle).toBe("00000000-0000-0000-0000-000000000007");
    expect(workspace.ref).toBe("workspace:7");
    expect(calls).toEqual([
      {
        method: "workspace.create",
        params: { title: "cmux-playground", focus: true },
      },
      {
        method: "surface.send_text",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000007",
          text: "echo hello world\n",
        },
      },
    ]);
  });

  test("opens an ssh workspace through direct socket RPC", async () => {
    const calls: Array<{ method: string; params: CmuxRpcParams }> = [];
    const cmux = createCmuxClient({
      printCommands: false,
      rpcRunner: (method, params) => {
        calls.push({ method, params });
        if (method === "workspace.create") {
          return {
            workspace_id: "00000000-0000-0000-0000-000000000012",
            workspace_ref: "workspace:12",
          };
        }
        return {
          workspace_id: "00000000-0000-0000-0000-000000000012",
          workspace_ref: "workspace:12",
        };
      },
    });

    const workspace = await cmux.ssh({
      destination: "vm:token@example.com",
      name: "website",
      port: 2222,
      identity: "/tmp/key",
      sshOptions: ["StrictHostKeyChecking=no"],
      skipDaemonBootstrap: true,
    });

    expect(workspace.handle).toBe("00000000-0000-0000-0000-000000000012");
    expect(calls).toEqual([
      {
        method: "workspace.create",
        params: {
          initial_command: "ssh -p 2222 -i /tmp/key -o StrictHostKeyChecking=no vm:token@example.com",
        },
      },
      {
        method: "workspace.rename",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000012",
          title: "website",
        },
      },
      {
        method: "workspace.remote.configure",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000012",
          destination: "vm:token@example.com",
          auto_connect: true,
          terminal_startup_command: "ssh -p 2222 -i /tmp/key -o StrictHostKeyChecking=no vm:token@example.com",
          port: 2222,
          identity_file: "/tmp/key",
          ssh_options: ["StrictHostKeyChecking=no"],
          skip_daemon_bootstrap: true,
        },
      },
      {
        method: "workspace.select",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000012",
        },
      },
    ]);
  });

  test("creates panes, opens browsers, and sends terminal text", async () => {
    const calls: Array<{ method: string; params: CmuxRpcParams }> = [];
    const cmux = createCmuxClient({
      printCommands: false,
      rpcRunner: (method, params) => {
        calls.push({ method, params });
        if (method === "pane.create") {
          return {
            workspace_id: "00000000-0000-0000-0000-000000000009",
            workspace_ref: "workspace:9",
            surface_id: "00000000-0000-0000-0000-000000000007",
            surface_ref: "surface:7",
            pane_id: "00000000-0000-0000-0000-000000000008",
            pane_ref: "pane:8",
          };
        }
        if (method === "browser.open_split") {
          return {
            workspace_id: "00000000-0000-0000-0000-000000000009",
            workspace_ref: "workspace:9",
            surface_id: "00000000-0000-0000-0000-000000000010",
            surface_ref: "surface:10",
            pane_id: "00000000-0000-0000-0000-000000000011",
            pane_ref: "pane:11",
          };
        }
        return {};
      },
    });

    const pane = await cmux.newPane({
      workspace: "00000000-0000-0000-0000-000000000009",
      type: "terminal",
      direction: "down",
      focus: false,
    });
    await cmux.send({
      workspace: "00000000-0000-0000-0000-000000000009",
      surface: pane.surface,
      text: "pnpm dev\\n",
    });
    await cmux.portsKick({
      workspace: "00000000-0000-0000-0000-000000000009",
      surface: pane.surface,
      reason: "refresh",
    });
    await cmux.browserOpen({
      workspace: "00000000-0000-0000-0000-000000000009",
      url: "http://localhost:3000",
      focus: true,
    });

    expect(pane.surface).toBe("00000000-0000-0000-0000-000000000007");
    expect(calls).toEqual([
      {
        method: "pane.create",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000009",
          type: "terminal",
          direction: "down",
          focus: false,
        },
      },
      {
        method: "surface.send_text",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000009",
          surface_id: "00000000-0000-0000-0000-000000000007",
          text: "pnpm dev\\n",
        },
      },
      {
        method: "surface.ports_kick",
        params: {
          workspace_id: "00000000-0000-0000-0000-000000000009",
          surface_id: "00000000-0000-0000-0000-000000000007",
          reason: "refresh",
        },
      },
      {
        method: "browser.open_split",
        params: {
          url: "http://localhost:3000",
          workspace_id: "00000000-0000-0000-0000-000000000009",
          focus: true,
        },
      },
    ]);
  });

  test("waits for remote workspace proxy readiness", async () => {
    let listCalls = 0;
    const calls: Array<{ method: string; params: CmuxRpcParams }> = [];
    const cmux = createCmuxClient({
      printCommands: false,
      sleep: async () => {},
      rpcRunner: (method, params) => {
        calls.push({ method, params });
        if (method !== "workspace.list") return {};

        listCalls += 1;
        return {
          workspaces: [
            {
              id: "00000000-0000-0000-0000-000000000012",
              ref: "workspace:12",
              remote: listCalls === 1
                ? {
                  connected: false,
                  state: "connecting",
                  proxy: { state: "connecting" },
                  detail: "Connecting",
                }
                : {
                  connected: true,
                  state: "connected",
                  proxy: {
                    state: "ready",
                    host: "127.0.0.1",
                    port: 49152,
                  },
                  detail: "Connected",
                },
            },
          ],
        };
      },
    });

    const status = await cmux.waitForRemoteReady(
      "00000000-0000-0000-0000-000000000012",
      { timeoutMs: 1000, intervalMs: 1 },
    );

    expect(status.remote?.connected).toBe(true);
    expect(calls).toEqual([
      { method: "workspace.list", params: {} },
      { method: "workspace.list", params: {} },
    ]);
  });

  test("prints shell-formatted commands when enabled", async () => {
    const logs: string[] = [];
    const cmux = createCmuxClient({
      logger: (message) => logs.push(message),
      rpcRunner: (method) => {
        if (method === "workspace.create") {
          return {
            workspace_id: "00000000-0000-0000-0000-000000000009",
          };
        }
        return {};
      },
    });

    await cmux.newWorkspace({ name: "hello world" });

    expect(logs).toEqual([
      "$ cmux rpc workspace.create '{\"title\":\"hello world\"}'",
    ]);
  });

  test("sends direct v2 rpc over the cmux socket from a cmux terminal env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fdev-cmux-"));
    const socketPath = join(dir, "cmux.sock");
    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex < 0) return;
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          const request = JSON.parse(line) as {
            id: string;
            method: string;
            params: CmuxRpcParams;
          };
          socket.write(JSON.stringify({
            id: request.id,
            ok: true,
            result: {
              workspace_id: "00000000-0000-0000-0000-000000000021",
              workspace_ref: "workspace:21",
              echo_method: request.method,
              echo_params: request.params,
            },
          }) + "\n");
        }
      });
    });
    const originalSocketPath = process.env.CMUX_SOCKET_PATH;
    const originalWorkspaceId = process.env.CMUX_WORKSPACE_ID;

    try {
      await listen(server, socketPath);
      process.env.CMUX_SOCKET_PATH = socketPath;
      process.env.CMUX_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

      const cmux = createCmuxClient({ printCommands: false });
      const workspace = await cmux.newWorkspace({ name: "direct" });

      expect(workspace.handle).toBe("00000000-0000-0000-0000-000000000021");
      expect(workspace.result).toMatchObject({
        echo_method: "workspace.create",
        echo_params: { title: "direct" },
      });
    } finally {
      restoreEnv("CMUX_SOCKET_PATH", originalSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", originalWorkspaceId);
      await closeServer(server);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails fast outside cmux before opening the socket", async () => {
    const originalSocketPath = process.env.CMUX_SOCKET_PATH;
    const originalWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const originalSurfaceId = process.env.CMUX_SURFACE_ID;

    delete process.env.CMUX_SOCKET_PATH;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;

    try {
      const cmux = createCmuxClient({
        printCommands: false,
      });

      await expect(cmux.newWorkspace({ name: "outside" })).rejects.toThrow(
        "cmux socket commands need a cmux-controlled terminal",
      );
    } finally {
      restoreEnv("CMUX_SOCKET_PATH", originalSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", originalWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", originalSurfaceId);
    }
  });

  test("detects cmux terminal environment", () => {
    expect(isInsideCmuxTerminal({})).toBe(false);
    expect(isInsideCmuxTerminal({ CMUX_SOCKET_PATH: "/tmp/cmux.sock" })).toBe(true);
    expect(isInsideCmuxTerminal({ CMUX_WORKSPACE_ID: "workspace-id" })).toBe(true);
    expect(isInsideCmuxTerminal({ CMUX_SURFACE_ID: "surface-id" })).toBe(true);
  });

  test("formats shell commands", () => {
    expect(formatShellCommand(["cmux", "new-workspace", "--name", "hello world"])).toBe(
      "cmux new-workspace --name 'hello world'",
    );
  });

  test("throws a structured error on raw cmux command failure", () => {
    const cmux = createCmuxClient({
      autoLaunch: false,
      printCommands: false,
      runner: (args) => {
        return { exitCode: 2, stdout: "", stderr: "bad command\n" };
      },
    });

    expect(() => cmux.run(["bad"])).toThrow(CmuxCommandError);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
