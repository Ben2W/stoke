import type { JsonValue } from "@stoke/engine";

export type ServeRuntimeOptions = {
  projectId: string;
  runtimeFingerprint?: string;
  projectDir: string;
  configPath: string;
  managedProjectId?: string;
  managedApiUrl?: string;
  managedToken?: string;
  stateFile?: string;
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
  readonly state: import("./state.ts").RuntimeStateCoordinator;
  readonly source?: JsonValue;
  readonly token: string;
  readonly startedAt: string;
  readonly getExpiresAt: () => string;
  readonly touch: () => void;
  readonly stop: () => void;
};
