export const CMUX_OPEN_CAPABILITY_ID = "cmux.open";

export const CMUX_OPEN_SCHEMA_HASH =
  "sha256:3a2975cfe53089c6a607da751b55575dc8806bd90132242d4b7e9065a26ae3af";

export const CMUX_OPEN_CAPABILITY = {
  id: CMUX_OPEN_CAPABILITY_ID,
  schemaHash: CMUX_OPEN_SCHEMA_HASH,
} as const;

export type CmuxOpenSshInput = string | {
  kind?: "ssh";
  destination?: string;
  host?: string;
  port?: number;
  username?: string;
  identity?: string;
  sshOptions?: readonly string[];
  remoteCommandArgs?: readonly string[];
  initialCommand?: string;
  terminalStartupCommand?: string;
  autoConnect?: boolean;
  skipDaemonBootstrap?: boolean;
};

export type CmuxRemoteReadyOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  requireProxy?: boolean;
};

export type CmuxOpenTerminalDirection = "left" | "right" | "up" | "down";
export type CmuxOpenSurfaceLayout = "splits" | "tabs";

export type CmuxOpenTerminalInput = {
  command: string;
  cwd?: string;
  direction?: CmuxOpenTerminalDirection;
  focus?: boolean;
};

export type CmuxOpenInput = {
  name: string;
  ssh?: CmuxOpenSshInput;
  cwd?: string;
  surfaceLayout?: CmuxOpenSurfaceLayout;
  terminals?: readonly CmuxOpenTerminalInput[];
  url?: string;
  focus?: boolean;
  waitForRemoteReady?: boolean | CmuxRemoteReadyOptions;
};

export type CmuxOpenPaneResult = {
  paneId?: string;
  paneRef?: string;
  surfaceId?: string;
  surfaceRef?: string;
};

export type CmuxOpenResult = {
  sessionId: string;
  workspaceId: string;
  workspaceRef?: string;
  terminalPanes: CmuxOpenPaneResult[];
  browserPane?: CmuxOpenPaneResult;
};

export type CmuxOpenSession = CmuxOpenResult & {
  closed: Promise<void>;
};
