export type ServeRuntimeOptions = {
  projectId: string;
  projectDir: string;
  configPath: string;
  statePath?: string;
  handlePath: string;
  tokenPath: string;
  token?: string;
  host?: string;
  port?: number;
  idleMs?: number;
};

export type RuntimeServer = {
  url: string;
  token: string;
  stop(): void;
};

export type RuntimeContext = {
  readonly projectId: string;
  readonly projectDir: string;
  readonly configPath: string;
  readonly statePath?: string;
  readonly token: string;
  readonly startedAt: string;
  readonly getExpiresAt: () => string;
  readonly touch: () => void;
  readonly stop: () => void;
};
