import type { ManagedRun } from "@usestoke/managed";

export function formatRunDuration(run: Pick<ManagedRun, "completedAt" | "startedAt" | "updatedAt">): string {
  const end = run.completedAt ?? run.updatedAt;
  return formatDuration(Math.max(0, Date.parse(end) - Date.parse(run.startedAt)));
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
