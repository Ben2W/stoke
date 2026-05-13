export const CMUX_OPEN_CAPABILITY_ID = "cmux.open";

export const CMUX_OPEN_SCHEMA_HASH =
  "sha256:ed7f74b4fd1101ff87281c0269f9884f85783098d9a727fdfe05491efba2dd28";

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
  auth?: { type: "token"; token: string } | { type: "privateKey"; privateKey: string };
  command?: string;
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
