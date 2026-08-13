export type RunNotification =
  | { type: "runs.changed" }
  | { type: "run.changed"; runId: string };

export function parseRunNotification(value: unknown): RunNotification | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
  if (value.type === "runs.changed") return { type: "runs.changed" };
  if (value.type !== "run.changed" || !("runId" in value) || typeof value.runId !== "string") {
    return undefined;
  }
  return { type: "run.changed", runId: value.runId };
}
