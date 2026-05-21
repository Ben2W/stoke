export const CMUX_CALL_CAPABILITY_ID = "cmux.call";

export const CMUX_CALL_SCHEMA_HASH =
  "sha256:afcc8ef7251d854c80d1c04d9a98bc9afbd22d2ab15e1ce9fb880452ec17f6cf";

export const CMUX_CALL_CAPABILITY = {
  id: CMUX_CALL_CAPABILITY_ID,
  schemaHash: CMUX_CALL_SCHEMA_HASH,
} as const;

export type CmuxCallMethod =
  | "newWorkspace"
  | "ssh"
  | "newPane"
  | "newSurface"
  | "browserOpen"
  | "send"
  | "portsKick"
  | "selectWorkspace"
  | "waitForRemoteReady";

export type CmuxCallInput = {
  method: CmuxCallMethod;
  params?: Record<string, unknown>;
};

export type CmuxSshInput = string | {
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
  name?: string;
  noFocus?: boolean;
};

export type CmuxWorkspaceInput = {
  name?: string;
  description?: string;
  cwd?: string;
  command?: string;
  focus?: boolean;
};

export type CmuxPaneDirection = "left" | "right" | "up" | "down";
export type CmuxSurfaceType = "terminal" | "browser";

export type CmuxNewPaneInput = {
  workspace?: string;
  type?: CmuxSurfaceType;
  direction?: CmuxPaneDirection;
  url?: string;
  focus?: boolean;
};

export type CmuxNewSurfaceInput = {
  workspace?: string;
  pane?: string;
  type?: CmuxSurfaceType;
  url?: string;
  focus?: boolean;
};

export type CmuxBrowserOpenInput = {
  workspace?: string;
  window?: string;
  url?: string;
  focus?: boolean;
};

export type CmuxSendInput = {
  workspace?: string;
  surface?: string;
  text: string;
};

export type CmuxPortsKickInput = {
  workspace: string;
  surface?: string;
  reason?: "command" | "refresh";
};

export type CmuxRemoteReadyInput = {
  workspace: string;
  timeoutMs?: number;
  intervalMs?: number;
  requireProxy?: boolean;
};

export type CmuxWorkspaceResult = {
  sessionId: string;
  workspaceId: string;
  workspaceRef?: string;
};

export type CmuxPaneResult = {
  paneId?: string;
  paneRef?: string;
  surfaceId?: string;
  surfaceRef?: string;
};
