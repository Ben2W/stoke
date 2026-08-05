#!/usr/bin/env bun
import { resolve } from "node:path";
import { serveRuntime } from "./runtime/server.ts";

type ServeArgs = {
  projectId?: string;
  runtimeFingerprint?: string;
  projectDir?: string;
  configPath?: string;
  managedProjectId?: string;
  managedApiUrl?: string;
  stateFile?: string;
  sourceJson?: string;
  handlePath?: string;
  tokenPath?: string;
  host?: string;
  port?: number;
  idleMs?: number;
};

const [command, ...args] = process.argv.slice(2);

if (command !== "serve") {
  console.error(`Usage: stoke-project-runtime serve --project-id <id> --project-dir <dir> --config <file> --handle <file> --token <file>`);
  process.exit(1);
}

const options = parseServeArgs(args);
const missing = [
  ["--project-id", options.projectId],
  ["--project-dir", options.projectDir],
  ["--config", options.configPath],
  ["--handle", options.handlePath],
  ["--token", options.tokenPath],
].filter(([, value]) => !value);
if (missing.length > 0) {
  console.error(`Missing required runtime args: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

const runtime = await serveRuntime({
  projectId: options.projectId!,
  runtimeFingerprint: options.runtimeFingerprint,
  projectDir: resolve(options.projectDir!),
  configPath: resolve(options.configPath!),
  managedProjectId: options.managedProjectId,
  managedApiUrl: options.managedApiUrl,
  managedToken: process.env.STOKE_RUNTIME_TOKEN,
  stateFile: options.stateFile ? resolve(options.stateFile) : undefined,
  source: options.sourceJson ? JSON.parse(options.sourceJson) : undefined,
  handlePath: resolve(options.handlePath!),
  tokenPath: resolve(options.tokenPath!),
  host: options.host,
  port: options.port,
  idleMs: options.idleMs,
});

console.log(JSON.stringify({
  type: "ready",
  url: runtime.url,
  token: runtime.token,
}));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runtime.stop();
  });
}

await runtime.closed;
await Bun.sleep(25);
process.exit(0);

function parseServeArgs(args: string[]): ServeArgs {
  const parsed: ServeArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const next = args[index + 1];
    const readValue = () => {
      if (!next) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };

    switch (arg) {
      case "--project-id":
        parsed.projectId = readValue();
        break;
      case "--runtime-fingerprint":
        parsed.runtimeFingerprint = readValue();
        break;
      case "--project-dir":
      case "--project":
        parsed.projectDir = readValue();
        break;
      case "--config":
        parsed.configPath = readValue();
        break;
      case "--managed-project-id":
        parsed.managedProjectId = readValue();
        break;
      case "--managed-api-url":
        parsed.managedApiUrl = readValue();
        break;
      case "--state-file":
        parsed.stateFile = readValue();
        break;
      case "--source-json":
        parsed.sourceJson = readValue();
        break;
      case "--handle":
        parsed.handlePath = readValue();
        break;
      case "--token":
        parsed.tokenPath = readValue();
        break;
      case "--host":
        parsed.host = readValue();
        break;
      case "--port":
        parsed.port = Number(readValue());
        break;
      case "--idle-ms":
        parsed.idleMs = Number(readValue());
        break;
      default:
        throw new Error(`Unknown runtime arg ${arg}`);
    }
  }
  return parsed;
}
