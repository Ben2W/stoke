export const CMUX_OPEN_CAPABILITY_ID = "cmux.open";

export const CMUX_OPEN_SCHEMA_HASH =
  "sha256:671373232fc79a7f75dd01c8c83c0c350af62b349a89bb3cfcc96af2cd76c878";

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

export type CmuxOpenInput = {
  name: string;
  ssh?: CmuxOpenSshInput;
  cwd?: string;
  command?: string;
  url?: string;
  focus?: boolean;
  waitForRemoteReady?: boolean | CmuxRemoteReadyOptions;
};

export type CmuxOpenResult = {
  sessionId: string;
  workspaceId: string;
  workspaceRef?: string;
  terminalPaneId?: string;
  terminalSurfaceId?: string;
  browserPaneId?: string;
  browserSurfaceId?: string;
};

export type CmuxOpenSession = CmuxOpenResult & {
  closed: Promise<void>;
};
