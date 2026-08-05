import type { ManagedRun } from "@usestoke/managed";

export function latestRemoteMainRun(runs: ManagedRun[]): ManagedRun | undefined {
  return runs
    .filter((run) =>
      run.origin !== "machine"
      && run.status === "completed"
      && (run.operation === "plan" || run.operation === "apply")
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
}
