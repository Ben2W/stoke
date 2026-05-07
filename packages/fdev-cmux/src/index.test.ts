import { describe, expect, test } from "bun:test";
import {
  CmuxCommandError,
  createCmuxClient,
  formatShellCommand,
  parseCmuxHandle,
  type CmuxCommandRunner,
} from "./index.ts";

describe("cmux sdk", () => {
  test("parses workspace refs from cmux text output", () => {
    expect(parseCmuxHandle("OK workspace:3\n", "workspace")).toBe("workspace:3");
  });

  test("creates a workspace with command text", async () => {
    const calls: string[][] = [];
    const runner: CmuxCommandRunner = (args) => {
      calls.push([...args]);
      if (args.join(" ") === "cmux ping") {
        return { exitCode: 0, stdout: "pong\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "OK workspace:7\n", stderr: "" };
    };

    const cmux = createCmuxClient({ printCommands: false, runner });
    const workspace = await cmux.newWorkspace({
      name: "cmux-playground",
      command: "echo hello world",
      focus: true,
    });

    expect(workspace.handle).toBe("workspace:7");
    expect(calls).toEqual([
      [
        "cmux",
        "new-workspace",
        "--name",
        "cmux-playground",
        "--command",
        "echo hello world",
        "--focus",
        "true",
      ],
    ]);
  });

  test("prints shell-formatted commands when enabled", async () => {
    const logs: string[] = [];
    const cmux = createCmuxClient({
      logger: (message) => logs.push(message),
      runner: (args) => {
        if (args.join(" ") === "cmux ping") {
          return { exitCode: 0, stdout: "pong\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "OK workspace:9\n", stderr: "" };
      },
    });

    await cmux.newWorkspace({ name: "hello world" });

    expect(logs).toEqual([
      "$ cmux new-workspace --name 'hello world'",
    ]);
  });

  test("launches cmux and retries the workspace command when needed", async () => {
    const calls: string[][] = [];
    const cmux = createCmuxClient({
      printCommands: false,
      sleep: async () => {},
      runner: (args) => {
        calls.push([...args]);
        if (args.join(" ") === "cmux new-workspace --name retry") {
          const attempt = calls.filter((call) => call.join(" ") === args.join(" ")).length;
          return attempt === 1
            ? { exitCode: 1, stdout: "", stderr: "socket not found\n" }
            : { exitCode: 0, stdout: "OK workspace:11\n", stderr: "" };
        }
        if (args.join(" ") === "open -a cmux") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 99, stdout: "", stderr: "unexpected\n" };
      },
    });

    const workspace = await cmux.newWorkspace({ name: "retry" });

    expect(workspace.handle).toBe("workspace:11");
    expect(calls).toEqual([
      ["cmux", "new-workspace", "--name", "retry"],
      ["open", "-a", "cmux"],
      ["cmux", "new-workspace", "--name", "retry"],
    ]);
  });

  test("formats shell commands", () => {
    expect(formatShellCommand(["cmux", "new-workspace", "--name", "hello world"])).toBe(
      "cmux new-workspace --name 'hello world'",
    );
  });

  test("throws a structured error on cmux command failure", async () => {
    const cmux = createCmuxClient({
      autoLaunch: false,
      printCommands: false,
      runner: (args) => {
        return { exitCode: 2, stdout: "", stderr: "bad command\n" };
      },
    });

    await expect(cmux.newWorkspace()).rejects.toThrow(CmuxCommandError);
  });
});
