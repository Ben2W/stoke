import type { JsonValue } from "@rigkit/engine";

export type ServeRuntimeOptions = {
  projectId: string;
  runtimeFingerprint?: string;
  projectDir: string;
  configPath: string;
  statePath?: string;
  globalFragmentRoot?: string;
  source?: JsonValue;
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
  closed: Promise<void>;
  stop(): void;
};

export type RuntimeContext = {
  readonly projectId: string;
  readonly runtimeFingerprint?: string;
  readonly projectDir: string;
  readonly configPath: string;
  readonly statePath?: string;
  readonly globalFragmentRoot?: string;
  readonly source?: JsonValue;
  readonly token: string;
  readonly startedAt: string;
  readonly getExpiresAt: () => string;
  readonly touch: () => void;
  readonly stop: () => void;
};
