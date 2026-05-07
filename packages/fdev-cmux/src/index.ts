export type CmuxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CmuxCommandRunner = (
  args: readonly string[],
) => CmuxCommandResult;

export type CmuxClientOptions = {
  bin?: string;
  autoLaunch?: boolean;
  allowExternalAutomation?: boolean;
  launchCommand?: readonly string[];
  printCommands?: boolean;
  logger?: (message: string) => void;
  readyAttempts?: number;
  readyDelayMs?: number;
  runner?: CmuxCommandRunner;
  sleep?: (ms: number) => Promise<void>;
};

export type CmuxNewWorkspaceOptions = {
  name?: string;
  description?: string;
  cwd?: string;
  command?: string;
  focus?: boolean;
};

export type CmuxWorkspace = {
  handle: string;
  stdout: string;
};

export class CmuxCommandError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(args: readonly string[], result: CmuxCommandResult) {
    const output = [
      result.stderr.trim() ? `stderr:\n${result.stderr.trimEnd()}` : "",
      result.stdout.trim() ? `stdout:\n${result.stdout.trimEnd()}` : "",
    ].filter(Boolean).join("\n");
    super(
      `cmux command failed with exit code ${result.exitCode}: ${args.join(" ")}${
        output ? `\n${output}` : ""
      }`,
    );
    this.name = "CmuxCommandError";
    this.args = args;
    this.exitCode = result.exitCode;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
  }
}

export class CmuxClient {
  private readonly bin: string;
  private readonly autoLaunch: boolean;
  private readonly allowExternalAutomation: boolean;
  private readonly launchCommand: readonly string[];
  private readonly printCommands: boolean;
  private readonly logger: (message: string) => void;
  private readonly commandAttempts: number;
  private readonly commandRetryDelayMs: number;
  private readonly runner: CmuxCommandRunner;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CmuxClientOptions = {}) {
    this.bin = options.bin ?? "cmux";
    this.autoLaunch = options.autoLaunch ?? true;
    this.allowExternalAutomation = options.allowExternalAutomation ?? false;
    this.launchCommand = options.launchCommand ?? ["open", "-a", "cmux"];
    this.printCommands = options.printCommands ?? true;
    this.logger = options.logger ?? ((message) => console.error(message));
    this.commandAttempts = options.readyAttempts ?? 40;
    this.commandRetryDelayMs = options.readyDelayMs ?? 250;
    this.runner = options.runner ?? runSpawnSync;
    this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  }

  async ensureRunning(): Promise<void> {
    if (this.tryRunRaw([this.bin, "ping"]).ok) return;
    if (!this.canControlCmuxFromHere()) {
      throw new Error(cmuxTerminalRequiredMessage([this.bin, "ping"]));
    }
    if (!this.autoLaunch || process.platform !== "darwin") {
      throw new Error("cmux is not running");
    }

    this.runRaw(this.launchCommand);
    for (let attempt = 0; attempt < this.commandAttempts; attempt += 1) {
      await this.sleep(this.commandRetryDelayMs);
      if (this.tryRunRaw([this.bin, "ping"]).ok) return;
    }

    throw new Error("cmux did not become ready after launching it");
  }

  async newWorkspace(
    options: CmuxNewWorkspaceOptions = {},
  ): Promise<CmuxWorkspace> {
    const args = [this.bin, "new-workspace"];
    if (options.name) args.push("--name", options.name);
    if (options.description) args.push("--description", options.description);
    if (options.cwd) args.push("--cwd", options.cwd);
    if (options.command) args.push("--command", options.command);
    if (options.focus !== undefined) args.push("--focus", String(options.focus));

    const stdout = await this.runCmuxCommandWithLaunchRetry(args);
    return {
      handle: parseCmuxHandle(stdout, "workspace"),
      stdout,
    };
  }

  run(args: readonly string[]): string {
    return this.runRaw([this.bin, ...args]);
  }

  ok(args: readonly string[]): boolean {
    const command = [this.bin, ...args];
    try {
      this.printCommand(command);
      const result = this.runner(command);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private runRaw(args: readonly string[]): string {
    const result = this.tryRunRaw(args);
    if (!result.ok) {
      throw new CmuxCommandError(args, result.result);
    }
    return result.result.stdout;
  }

  private tryRunRaw(args: readonly string[]):
    | { ok: true; result: CmuxCommandResult }
    | { ok: false; result: CmuxCommandResult } {
    this.printCommand(args);
    const result = this.runner(args);
    return result.exitCode === 0
      ? { ok: true, result }
      : { ok: false, result };
  }

  private async runCmuxCommandWithLaunchRetry(args: readonly string[]): Promise<string> {
    const first = this.tryRunRaw(args);
    if (first.ok) return first.result.stdout;

    if (isCmuxSocketControlFailure(first.result) && !this.canControlCmuxFromHere()) {
      throw new Error(cmuxTerminalRequiredMessage(args, first.result));
    }

    if (!this.autoLaunch || process.platform !== "darwin") {
      throw new CmuxCommandError(args, first.result);
    }

    this.runRaw(this.launchCommand);
    let last = first.result;
    for (let attempt = 0; attempt < this.commandAttempts; attempt += 1) {
      await this.sleep(this.commandRetryDelayMs);
      const next = this.tryRunRaw(args);
      if (next.ok) return next.result.stdout;
      last = next.result;
    }

    throw new CmuxCommandError(args, last);
  }

  private printCommand(args: readonly string[]): void {
    if (!this.printCommands) return;
    this.logger(`$ ${formatShellCommand(args)}`);
  }

  private canControlCmuxFromHere(): boolean {
    return this.allowExternalAutomation || isInsideCmuxTerminal();
  }
}

export function createCmuxClient(options?: CmuxClientOptions): CmuxClient {
  return new CmuxClient(options);
}

export function parseCmuxHandle(output: string, kind: string): string {
  const ref = new RegExp(`\\b${kind}:[^\\s]+`).exec(output)?.[0];
  if (ref) return ref;

  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.exec(output)?.[0];
  if (uuid) return uuid;

  throw new Error(`cmux output did not include a ${kind} handle: ${output.trim()}`);
}

export function isInsideCmuxTerminal(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    nonEmpty(environment.CMUX_SOCKET_PATH) ||
      nonEmpty(environment.CMUX_WORKSPACE_ID) ||
      nonEmpty(environment.CMUX_SURFACE_ID),
  );
}

export function formatShellCommand(args: readonly string[]): string {
  return args.map(shellQuote).join(" ");
}

export { FDEV_CMUX_VERSION } from "./version.ts";

function runSpawnSync(args: readonly string[]): CmuxCommandResult {
  const result = Bun.spawnSync([...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function isCmuxSocketControlFailure(result: CmuxCommandResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return [
    "socket not found",
    "failed to write to socket",
    "failed to connect to socket",
    "socket closed",
    "broken pipe",
    "access denied",
    "only processes started inside cmux",
  ].some((needle) => output.includes(needle));
}

function cmuxTerminalRequiredMessage(
  args: readonly string[],
  result?: CmuxCommandResult,
): string {
  const output = result
    ? [
      result.stderr.trim() ? `stderr:\n${result.stderr.trimEnd()}` : "",
      result.stdout.trim() ? `stdout:\n${result.stdout.trimEnd()}` : "",
    ].filter(Boolean).join("\n")
    : "";

  return [
    "cmux socket commands need a cmux-controlled terminal by default.",
    "",
    `command: ${formatShellCommand(args)}`,
    "",
    "`cmux new-workspace` and `cmux ssh` are socket commands. With cmux's default socket control mode (`cmuxOnly`), they work from terminals started inside cmux because cmux sets CMUX_SOCKET_PATH/CMUX_WORKSPACE_ID and accepts descendant processes.",
    "",
    "Run this fdev workflow from a cmux terminal, or enable cmux Automation/Password socket control and create the client with `allowExternalAutomation: true`.",
    output,
  ].filter(Boolean).join("\n");
}
