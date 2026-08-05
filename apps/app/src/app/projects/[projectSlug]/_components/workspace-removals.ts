import type { ManagedRun, ManagedWorkspace } from "@usestoke/managed";

export function workspaceRemovalFor(
  runs: ManagedRun[],
  workspace: ManagedWorkspace,
): ManagedRun | undefined {
  const workspaceCreatedAt = Date.parse(workspace.createdAt);
  return runs.find((run) =>
    run.operation === "remove"
    && run.workspace === workspace.name
    && Date.parse(run.startedAt) >= workspaceCreatedAt
  );
}

export function unmatchedActiveRemovals(
  runs: ManagedRun[],
  workspaces: ManagedWorkspace[],
): ManagedRun[] {
  const workspaceNames = new Set(workspaces.map((workspace) => workspace.name));
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (
      run.operation !== "remove"
      || run.status !== "running"
      || !run.workspace
      || workspaceNames.has(run.workspace)
      || seen.has(run.workspace)
    ) return false;
    seen.add(run.workspace);
    return true;
  });
}
