import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";

export type RunLogLine = {
  id: string;
  message: string;
  source: string;
  stream: "error" | "info" | "stderr" | "stdout";
  timestamp: string;
};

export function projectRunLogs(events: ManagedRunEvent[], run: ManagedRun): RunLogLine[] {
  const lines: RunLogLine[] = [];
  for (const event of events) {
    const projected = projectEvent(event);
    if (!projected) continue;
    const previous = lines.at(-1);
    if (event.type === "remote.log.output" && previous?.source === projected.source) {
      previous.message += projected.message;
      continue;
    }
    lines.push(projected);
  }
  if ((run.status === "failed" || run.status === "orphaned") && run.error) {
    const alreadyRecorded = lines.some((line) => line.message.includes(run.error!));
    if (!alreadyRecorded) {
      lines.push({
        id: `${run.id}-error`,
        message: run.error,
        source: "stoke",
        stream: "error",
        timestamp: run.completedAt ?? run.updatedAt,
      });
    }
  }
  return lines;
}

export function runLogsText(lines: RunLogLine[]): string {
  return lines.map((line) => `${formatLogTime(line.timestamp)}  ${line.message.trimEnd()}`).join("\n");
}

function projectEvent(event: ManagedRunEvent): RunLogLine | undefined {
  const base = { id: String(event.id), timestamp: event.createdAt };
  if (event.type === "remote.command.started") {
    const command = stringField(event.data.command);
    return command ? { ...base, message: `Starting ${command}`, source: "sandbox", stream: "info" } : undefined;
  }
  if (event.type === "remote.command.completed") {
    const command = stringField(event.data.command);
    if (!command) return undefined;
    const exitCode = numberField(event.data.exitCode);
    const duration = numberField(event.data.durationMs);
    return {
      ...base,
      message: `${command} ${exitCode === 0 ? "completed" : `failed with exit code ${exitCode ?? "unknown"}`}${duration === undefined ? "" : ` in ${formatMilliseconds(duration)}`}`,
      source: "sandbox",
      stream: exitCode === 0 ? "info" : "error",
    };
  }
  if (event.type === "remote.log.output") {
    const data = stringField(event.data.data, true);
    if (!data) return undefined;
    const stream = logStream(event.data.stream);
    return {
      ...base,
      message: data,
      source: stringField(event.data.path) ?? stringField(event.data.source) ?? "sandbox",
      stream,
    };
  }
  if (event.type === "command.started") {
    const command = stringField(event.data.command) ?? stringField(event.data.commandName);
    return command ? { ...base, message: `$ ${command}`, source: nodeSource(event), stream: "stdout" } : undefined;
  }
  if (event.type === "command.output" || event.type === "log.output") {
    const data = stringField(event.data.data, true);
    return data ? { ...base, message: data, source: nodeSource(event), stream: logStream(event.data.stream) } : undefined;
  }
  if (event.type === "command.completed" && numberField(event.data.exitCode) !== 0) {
    return {
      ...base,
      message: `${stringField(event.data.commandName) ?? "command"} exited ${numberField(event.data.exitCode) ?? "unknown"}`,
      source: nodeSource(event),
      stream: "error",
    };
  }
  if (event.type === "host.capability.request") {
    const capability = stringField(event.data.capability);
    if (capability === "browser.open") {
      const params = recordField(event.data.params);
      const displayName = params ? stringField(params.displayName) : undefined;
      return { ...base, message: `${displayName ?? "Development preview"} ready`, source: "dashboard", stream: "info" };
    }
    if (capability === "ssh") return { ...base, message: "Opening SSH session…", source: "dashboard", stream: "info" };
  }
  if (event.type === "run.failed") {
    const error = recordField(event.data.error);
    const message = error ? stringField(error.message) : undefined;
    return message ? { ...base, message, source: "stoke", stream: "error" } : undefined;
  }
  return undefined;
}

function nodeSource(event: ManagedRunEvent): string {
  return stringField(event.data.nodePath) ?? "workflow";
}

function logStream(value: unknown): RunLogLine["stream"] {
  if (value === "stderr" || value === "error") return "stderr";
  if (value === "stdout") return "stdout";
  return "info";
}

function formatMilliseconds(value: number): string {
  return value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`;
}

function formatLogTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function stringField(value: unknown, allowWhitespace = false): string | undefined {
  if (typeof value !== "string" || (!allowWhitespace && !value.trim())) return undefined;
  return value;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
