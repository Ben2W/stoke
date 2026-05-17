// Persists every runtime event for a single run to `.rigkit/logs/`. The
// presenter on stderr stays terse; this file is the unfiltered transcript you
// grep when something goes wrong. NDJSON, one event per line, plus a couple of
// envelope records (run.start / run.end) so logs stand on their own.
//
// On failure we also splice in the daemon's stderr emitted during this run's
// time window. The daemon's "INTERNAL_ERROR: Internal server error" event
// carries no stack — the real trace is in its stderr. We capture that to
// `runtimeLogPath` (in runtime-client) and tail it here so the run log is
// self-contained.

import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const LOG_DIR_NAME = "logs";
const MAX_LOG_FILES = 50;

export type RunLogger = {
  append(event: unknown): void;
  finish(outcome: { status: "completed" | "failed"; error?: unknown; result?: unknown }): void;
  close(): void;
  path: string;
};

export function createRunLogger(input: {
  projectDir: string;
  operation: string;
  runtimeStateDir?: string;
  // Daemon stderr file. When the run fails we splice everything written here
  // during this run's time window into the run log.
  daemonStderrPath?: string;
}): RunLogger | undefined {
  const logDir = resolveLogDir(input);
  if (!logDir) return undefined;

  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    return undefined;
  }

  const path = join(logDir, `${fileTimestamp()}-${slugify(input.operation)}.log`);

  let fd: number;
  try {
    fd = openSync(path, "a");
  } catch {
    return undefined;
  }

  rotate(logDir);

  const startedAt = new Date().toISOString();
  // Snapshot the daemon log's current size so we can read only what this run
  // appended later. We don't want to dump the daemon's entire history.
  const daemonOffset = input.daemonStderrPath ? safeFileSize(input.daemonStderrPath) : 0;
  let closed = false;

  const writeLine = (value: unknown): void => {
    if (closed) return;
    try {
      appendFileSync(fd, `${JSON.stringify(value)}\n`);
    } catch {
      // best-effort: a logging failure should never break the run
    }
  };

  writeLine({
    ts: startedAt,
    type: "run.start",
    operation: input.operation,
    cwd: process.cwd(),
  });

  return {
    path,
    append(event) {
      writeLine({ ts: new Date().toISOString(), ...(toRecord(event) ?? { value: event }) });
    },
    finish(outcome) {
      if (outcome.status === "failed" && input.daemonStderrPath) {
        spliceDaemonStderr(input.daemonStderrPath, daemonOffset, writeLine);
      }
      writeLine({
        ts: new Date().toISOString(),
        type: "run.end",
        status: outcome.status,
        durationMs: Date.now() - Date.parse(startedAt),
        ...(outcome.error !== undefined ? { error: toErrorRecord(outcome.error) } : {}),
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      });
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    },
  };
}

function spliceDaemonStderr(
  path: string,
  offset: number,
  write: (value: unknown) => void,
): void {
  let fd: number | undefined;
  try {
    const size = safeFileSize(path);
    if (size <= offset) return;
    fd = openSync(path, "r");
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    const text = buffer.toString("utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      write({ ts: new Date().toISOString(), type: "daemon.stderr", data: line });
    }
  } catch {
    // best-effort: failure to splice should never break the run log
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
  }
}

function safeFileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function resolveLogDir(input: { projectDir: string; runtimeStateDir?: string }): string | undefined {
  if (input.runtimeStateDir) return join(input.runtimeStateDir, LOG_DIR_NAME);
  if (input.projectDir) return join(input.projectDir, ".rigkit", LOG_DIR_NAME);
  return undefined;
}

function rotate(logDir: string): void {
  try {
    const entries = readdirSync(logDir)
      .filter((name) => name.endsWith(".log"))
      .map((name) => {
        const filePath = join(logDir, name);
        return { path: filePath, mtime: statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const stale of entries.slice(MAX_LOG_FILES)) {
      try {
        unlinkSync(stale.path);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}

function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugify(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = cleaned.slice(0, 40);
  return slug || "run";
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toErrorRecord(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  const record = toRecord(value);
  return record ?? { message: String(value) };
}
