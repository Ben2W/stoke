import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { homedir } from "node:os";

export type CmuxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CmuxCommandRunner = (
  args: readonly string[],
) => CmuxCommandResult;

export type CmuxRpcParams = Record<string, CmuxRpcValue>;
export type CmuxRpcResult = Record<string, unknown>;
export type CmuxRpcValue =
  | string
  | number
  | boolean
  | null
  | readonly CmuxRpcValue[]
  | { readonly [key: string]: CmuxRpcValue };

export type CmuxRpcRunner = (
  method: string,
  params: CmuxRpcParams,
) => Promise<CmuxRpcResult> | CmuxRpcResult;

type SendSocketRpcOptions = {
  socketPath: string;
  socketPassword?: string;
  method: string;
  params: CmuxRpcParams;
  responseTimeoutMs?: number;
};

export type CmuxClientOptions = {
  bin?: string;
  socketPath?: string;
  socketPassword?: string;
  autoLaunch?: boolean;
  allowExternalAutomation?: boolean;
  launchCommand?: readonly string[];
  printCommands?: boolean;
  logger?: (message: string) => void;
  readyAttempts?: number;
  readyDelayMs?: number;
  runner?: CmuxCommandRunner;
  rpcRunner?: CmuxRpcRunner;
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
  id?: string;
  ref?: string;
  result?: CmuxRpcResult;
  stdout?: string;
};

export type CmuxSshOptions = {
  destination: string;
  name?: string;
  port?: number;
  identity?: string;
  sshOptions?: readonly string[];
  noFocus?: boolean;
  remoteCommandArgs?: readonly string[];
  initialCommand?: string;
  terminalStartupCommand?: string;
  autoConnect?: boolean;
  skipDaemonBootstrap?: boolean;
};

export type CmuxWorkspaceStatus = {
  handle: string;
  id?: string;
  ref?: string;
  remote?: CmuxRpcResult;
  result: CmuxRpcResult;
};

export type CmuxWaitForRemoteOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  requireProxy?: boolean;
};

export type CmuxNewPaneOptions = {
  workspace?: string;
  type?: "terminal" | "browser";
  direction?: "left" | "right" | "up" | "down";
  url?: string;
  focus?: boolean;
};

export type CmuxNewSurfaceOptions = {
  workspace?: string;
  pane?: string;
  type?: "terminal" | "browser";
  url?: string;
  focus?: boolean;
};

export type CmuxPane = {
  workspace?: string;
  workspaceRef?: string;
  pane?: string;
  paneRef?: string;
  surface?: string;
  surfaceRef?: string;
  result?: CmuxRpcResult;
  stdout?: string;
};

export type CmuxBrowserOpenOptions = {
  workspace?: string;
  window?: string;
  url?: string;
  focus?: boolean;
};

export type CmuxSendOptions = {
  workspace?: string;
  surface?: string;
  text: string;
};

export type CmuxPortsKickOptions = {
  workspace: string;
  surface?: string;
  reason?: "command" | "refresh";
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
  private readonly socketPath?: string;
  private readonly socketPassword?: string;
  private readonly autoLaunch: boolean;
  private readonly allowExternalAutomation: boolean;
  private readonly launchCommand: readonly string[];
  private readonly printCommands: boolean;
  private readonly logger: (message: string) => void;
  private readonly commandAttempts: number;
  private readonly commandRetryDelayMs: number;
  private readonly runner: CmuxCommandRunner;
  private readonly rpcRunner?: CmuxRpcRunner;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CmuxClientOptions = {}) {
    this.bin = options.bin ?? "cmux";
    this.socketPath = options.socketPath;
    this.socketPassword = options.socketPassword;
    this.autoLaunch = options.autoLaunch ?? true;
    this.allowExternalAutomation = options.allowExternalAutomation ?? false;
    this.launchCommand = options.launchCommand ?? ["open", "-a", "cmux"];
    this.printCommands = options.printCommands ?? true;
    this.logger = options.logger ?? ((message) => console.error(message));
    this.commandAttempts = options.readyAttempts ?? 40;
    this.commandRetryDelayMs = options.readyDelayMs ?? 250;
    this.runner = options.runner ?? runSpawnSync;
    this.rpcRunner = options.rpcRunner;
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
    const params: CmuxRpcParams = {};
    if (options.name) params.title = options.name;
    if (options.description) params.description = options.description;
    if (options.cwd) params.cwd = options.cwd;
    if (options.focus !== undefined) params.focus = options.focus;

    const result = await this.rpc("workspace.create", params);
    const workspace = workspaceFromResult(result);
    if (options.command) {
      await this.rpc("surface.send_text", {
        workspace_id: workspace.id ?? workspace.handle,
        text: `${options.command}\n`,
      });
    }
    return workspace;
  }

  async ssh(options: CmuxSshOptions): Promise<CmuxWorkspace> {
    const startupCommand = options.terminalStartupCommand ??
      options.initialCommand ??
      buildSshStartupCommand(options);
    const createResult = await this.rpc("workspace.create", {
      initial_command: startupCommand,
    });
    const workspace = workspaceFromResult(createResult);
    const workspaceId = workspace.id ?? workspace.handle;

    if (options.name) {
      await this.rpc("workspace.rename", {
        workspace_id: workspaceId,
        title: options.name,
      });
    }

    const configureParams: CmuxRpcParams = {
      workspace_id: workspaceId,
      destination: options.destination,
      auto_connect: options.autoConnect ?? true,
      terminal_startup_command: startupCommand,
    };
    if (options.port !== undefined) configureParams.port = options.port;
    if (options.identity) configureParams.identity_file = options.identity;
    if (options.sshOptions?.length) {
      configureParams.ssh_options = [...options.sshOptions];
    }
    if (options.skipDaemonBootstrap !== undefined) {
      configureParams.skip_daemon_bootstrap = options.skipDaemonBootstrap;
    }

    workspace.result = await this.rpc("workspace.remote.configure", configureParams);
    if (!options.noFocus) {
      await this.selectWorkspace(workspaceId);
    }

    return workspace;
  }

  async newPane(options: CmuxNewPaneOptions = {}): Promise<CmuxPane> {
    const params: CmuxRpcParams = {};
    if (options.type) params.type = options.type;
    if (options.direction) params.direction = options.direction;
    if (options.workspace) params.workspace_id = options.workspace;
    if (options.url) params.url = options.url;
    if (options.focus !== undefined) params.focus = options.focus;

    return paneFromResult(await this.rpc("pane.create", params));
  }

  async newSurface(options: CmuxNewSurfaceOptions = {}): Promise<CmuxPane> {
    const params: CmuxRpcParams = {};
    if (options.type) params.type = options.type;
    if (options.pane) params.pane_id = options.pane;
    if (options.workspace) params.workspace_id = options.workspace;
    if (options.url) params.url = options.url;
    if (options.focus !== undefined) params.focus = options.focus;

    return paneFromResult(await this.rpc("surface.create", params));
  }

  async listWorkspaces(): Promise<CmuxWorkspaceStatus[]> {
    const result = await this.rpc("workspace.list");
    const workspaces = Array.isArray(result.workspaces)
      ? result.workspaces.filter(isRecord)
      : [];
    return workspaces.map(workspaceStatusFromResult);
  }

  async workspaceStatus(workspace: string): Promise<CmuxWorkspaceStatus> {
    const workspaces = await this.listWorkspaces();
    const status = workspaces.find((candidate) =>
      candidate.id === workspace ||
      candidate.ref === workspace ||
      candidate.handle === workspace
    );
    if (!status) {
      throw new Error(`cmux workspace not found: ${workspace}`);
    }
    return status;
  }

  async waitForRemoteReady(
    workspace: string,
    options: CmuxWaitForRemoteOptions = {},
  ): Promise<CmuxWorkspaceStatus> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const intervalMs = options.intervalMs ?? 500;
    const requireProxy = options.requireProxy ?? true;
    const startedAt = Date.now();
    let lastStatus: CmuxWorkspaceStatus | undefined;

    while (Date.now() - startedAt <= timeoutMs) {
      lastStatus = await this.workspaceStatus(workspace);
      if (isRemoteReady(lastStatus, requireProxy)) {
        return lastStatus;
      }
      await this.sleep(intervalMs);
    }

    throw new Error(
      `cmux remote workspace did not become ready within ${timeoutMs}ms: ${remoteStatusSummary(lastStatus)}`,
    );
  }

  async browserOpen(options: CmuxBrowserOpenOptions = {}): Promise<CmuxPane> {
    const params: CmuxRpcParams = {};
    if (options.url) params.url = options.url;
    if (options.workspace) params.workspace_id = options.workspace;
    if (options.window) params.window_id = options.window;
    if (options.focus !== undefined) params.focus = options.focus;

    return paneFromResult(await this.rpc("browser.open_split", params));
  }

  async send(options: CmuxSendOptions): Promise<string> {
    const params: CmuxRpcParams = {
      text: options.text,
    };
    if (options.workspace) params.workspace_id = options.workspace;
    if (options.surface) params.surface_id = options.surface;
    await this.rpc("surface.send_text", params);
    return "OK";
  }

  async portsKick(options: CmuxPortsKickOptions): Promise<string> {
    const params: CmuxRpcParams = {
      workspace_id: options.workspace,
      reason: options.reason ?? "command",
    };
    if (options.surface) params.surface_id = options.surface;
    await this.rpc("surface.ports_kick", params);
    return "OK";
  }

  async selectWorkspace(workspace: string): Promise<string> {
    await this.rpc("workspace.select", { workspace_id: workspace });
    return "OK";
  }

  async rpc(method: string, params: CmuxRpcParams = {}): Promise<CmuxRpcResult> {
    this.printRpc(method, params);
    if (this.rpcRunner) {
      return await this.rpcRunner(method, params);
    }
    if (!this.canControlCmuxFromHere()) {
      throw new Error(cmuxSocketRequiredMessage(method, params));
    }

    return await sendSocketRpc({
      socketPath: this.resolvedSocketPath(),
      socketPassword: this.socketPassword ?? process.env.CMUX_SOCKET_PASSWORD,
      method,
      params,
    });
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

  private printCommand(args: readonly string[]): void {
    if (!this.printCommands) return;
    this.logger(`$ ${formatShellCommand(args)}`);
  }

  private printRpc(method: string, params: CmuxRpcParams): void {
    if (!this.printCommands) return;
    this.logger(`$ ${formatShellCommand([
      this.bin,
      "rpc",
      method,
      JSON.stringify(params),
    ])}`);
  }

  private canControlCmuxFromHere(): boolean {
    return this.allowExternalAutomation || isInsideCmuxTerminal();
  }

  private resolvedSocketPath(): string {
    if (this.socketPath) return this.socketPath;
    const envSocketPath = process.env.CMUX_SOCKET_PATH?.trim();
    const legacyEnvSocketPath = process.env.CMUX_SOCKET?.trim();
    if (envSocketPath && legacyEnvSocketPath && envSocketPath !== legacyEnvSocketPath) {
      throw new Error("Refusing to choose cmux socket: CMUX_SOCKET_PATH and CMUX_SOCKET differ.");
    }
    return envSocketPath || legacyEnvSocketPath || `${homedir()}/Library/Application Support/cmux/cmux.sock`;
  }
}

export function createCmuxClient(options?: CmuxClientOptions): CmuxClient {
  return new CmuxClient(options);
}

export function parseCmuxHandle(output: string, kind: string): string {
  const handle = parseOptionalCmuxHandle(output, kind);
  if (handle) return handle;

  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.exec(output)?.[0];
  if (uuid) return uuid;

  throw new Error(`cmux output did not include a ${kind} handle: ${output.trim()}`);
}

export function parseOptionalCmuxHandle(output: string, kind: string): string | undefined {
  const ref = new RegExp(`\\b${kind}:[^\\s]+`).exec(output)?.[0];
  if (ref) return ref;

  return undefined;
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

export { RIGKIT_PROVIDER_CMUX_VERSION } from "./version.ts";
export {
  CMUX_OPEN_CAPABILITY,
  CMUX_OPEN_CAPABILITY_ID,
  CMUX_OPEN_SCHEMA_HASH,
  type CmuxOpenInput,
  type CmuxOpenPaneResult,
  type CmuxOpenResult,
  type CmuxOpenSession,
  type CmuxOpenSurfaceLayout,
  type CmuxOpenSshInput,
  type CmuxOpenTerminalDirection,
  type CmuxOpenTerminalInput,
  type CmuxRemoteReadyOptions,
} from "./capabilities.ts";
export {
  CMUX_PROVIDER_ID,
  cmux,
  cmuxProviderPlugin,
  provider as defineCmuxProvider,
  parseCmuxOpenResult,
  requestCmuxOpen,
  type CmuxProviderDefinition,
  type CmuxRuntime,
} from "./provider.ts";

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

function workspaceFromResult(result: CmuxRpcResult): CmuxWorkspace {
  const id = stringValue(result.workspace_id);
  const ref = stringValue(result.workspace_ref);
  const handle = id ?? ref;
  if (!handle) {
    throw new Error(`cmux workspace response did not include workspace_id: ${JSON.stringify(result)}`);
  }
  return { handle, id, ref, result };
}

function workspaceStatusFromResult(result: CmuxRpcResult): CmuxWorkspaceStatus {
  const id = stringValue(result.id) ?? stringValue(result.workspace_id);
  const ref = stringValue(result.ref) ?? stringValue(result.workspace_ref);
  const handle = id ?? ref;
  if (!handle) {
    throw new Error(`cmux workspace status did not include id: ${JSON.stringify(result)}`);
  }
  const remote = isRecord(result.remote) ? result.remote : undefined;
  return { handle, id, ref, remote, result };
}

function paneFromResult(result: CmuxRpcResult): CmuxPane {
  return {
    workspace: stringValue(result.workspace_id),
    workspaceRef: stringValue(result.workspace_ref),
    pane: stringValue(result.pane_id),
    paneRef: stringValue(result.pane_ref),
    surface: stringValue(result.surface_id),
    surfaceRef: stringValue(result.surface_ref),
    result,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function buildSshStartupCommand(options: CmuxSshOptions): string {
  const args = ["ssh"];
  if (options.port !== undefined) {
    args.push("-p", String(options.port));
  }
  if (options.identity) {
    args.push("-i", options.identity);
  }
  for (const option of options.sshOptions ?? []) {
    args.push("-o", option);
  }
  args.push(options.destination);
  args.push(...(options.remoteCommandArgs ?? []));
  return formatShellCommand(args);
}

function cmuxSocketRequiredMessage(method: string, params: CmuxRpcParams): string {
  return cmuxTerminalRequiredMessage([
    "cmux",
    "rpc",
    method,
    JSON.stringify(params),
  ]);
}

function isRemoteReady(status: CmuxWorkspaceStatus, requireProxy: boolean): boolean {
  const remote = status.remote;
  if (!remote) return false;
  const connected = remote.connected === true || remote.state === "connected";
  if (!connected) return false;
  if (!requireProxy) return true;
  const proxy = isRecord(remote.proxy) ? remote.proxy : undefined;
  return proxy?.state === "ready";
}

function remoteStatusSummary(status: CmuxWorkspaceStatus | undefined): string {
  if (!status?.remote) return "no remote status";
  const proxy = isRecord(status.remote.proxy) ? status.remote.proxy : undefined;
  const daemon = isRecord(status.remote.daemon) ? status.remote.daemon : undefined;
  const parts = [
    `state=${String(status.remote.state ?? "unknown")}`,
    `connected=${String(status.remote.connected ?? false)}`,
    `proxy=${String(proxy?.state ?? "unknown")}`,
    `daemon=${String(daemon?.state ?? "unknown")}`,
    `daemon_detail=${String(daemon?.detail ?? "")}`,
    `detail=${String(status.remote.detail ?? "")}`,
  ];
  return parts.join(" ");
}

async function sendSocketRpc(options: SendSocketRpcOptions): Promise<CmuxRpcResult> {
  const timeoutMs = options.responseTimeoutMs ?? 15_000;
  const socket = createConnection({ path: options.socketPath });
  const cleanupFns: Array<() => void> = [];
  let buffer = "";

  const cleanup = () => {
    for (const cleanupFn of cleanupFns.splice(0)) {
      cleanupFn();
    }
    socket.destroy();
  };

  const nextLine = () =>
    new Promise<string>((resolve, reject) => {
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(new Error(`Timed out waiting for cmux socket response from ${options.socketPath}`));
      }, timeoutMs);

      const finish = (line: string) => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        resolve(line);
      };
      const tryResolveBufferedLine = () => {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) return false;
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        finish(line);
        return true;
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        tryResolveBufferedLine();
      };
      const onError = (error: Error) => fail(error);
      const onClose = () => fail(new Error("cmux socket closed before reply"));

      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
      cleanupFns.push(() => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      });

      tryResolveBufferedLine();
    });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out connecting to cmux socket at ${options.socketPath}`));
      }, timeoutMs);
      const onConnect = () => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
      cleanupFns.push(() => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("error", onError);
      });
    });

    if (options.socketPassword) {
      socket.write(`auth ${options.socketPassword}\n`);
      const authLine = await nextLine();
      if (authLine.startsWith("ERROR:") && !authLine.includes("Unknown command 'auth'")) {
        throw new Error(authLine);
      }
    }

    const request = {
      id: randomUUID(),
      method: options.method,
      params: options.params,
    };
    socket.write(`${JSON.stringify(request)}\n`);
    const raw = await nextLine();
    if (raw.startsWith("ERROR:")) {
      throw new Error(raw);
    }
    const response = JSON.parse(raw) as unknown;
    if (!isRecord(response)) {
      throw new Error(`Invalid cmux socket response: ${raw}`);
    }
    if (response.ok === true) {
      return isRecord(response.result) ? response.result : {};
    }
    if (isRecord(response.error)) {
      const code = typeof response.error.code === "string" ? response.error.code : "error";
      const message = typeof response.error.message === "string"
        ? response.error.message
        : "Unknown cmux socket error";
      throw new Error(`${code}: ${message}`);
    }
    throw new Error(`cmux socket request failed: ${raw}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid cmux socket JSON response: ${error.message}`);
    }
    throw error;
  } finally {
    cleanup();
  }
}

function isRecord(value: unknown): value is CmuxRpcResult {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    "Run this Rigkit workflow from a cmux terminal, or enable cmux Automation/Password socket control and create the client with `allowExternalAutomation: true`.",
    output,
  ].filter(Boolean).join("\n");
}
