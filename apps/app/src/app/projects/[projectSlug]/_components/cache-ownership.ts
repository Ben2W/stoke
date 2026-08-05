import type { ManagedWorkspace } from "@usestoke/managed";

type WorkspaceCacheOwner = Pick<ManagedWorkspace, "cacheEntryIds" | "id" | "name" | "sourceRevision">;

export type CacheOwnershipGroup = {
  entryIds: Set<string>;
  key: string;
  main: boolean;
  workspaces: Array<{ id: string; name: string; revision?: string }>;
};

export function groupCacheOwnership(
  mainEntryIds: Set<string>,
  workspaces: WorkspaceCacheOwner[],
): CacheOwnershipGroup[] {
  const groups = new Map<string, CacheOwnershipGroup>();
  const mainKey = cacheEntrySetKey(mainEntryIds);
  if (mainKey) {
    groups.set(mainKey, {
      entryIds: new Set(mainEntryIds),
      key: mainKey,
      main: true,
      workspaces: [],
    });
  }

  for (const workspace of workspaces) {
    const entryIds = new Set(workspace.cacheEntryIds ?? []);
    const key = cacheEntrySetKey(entryIds);
    if (!key) continue;
    const group = groups.get(key) ?? {
      entryIds,
      key,
      main: false,
      workspaces: [],
    };
    group.workspaces.push({
      id: workspace.id,
      name: workspace.name,
      ...(workspace.sourceRevision ? { revision: workspace.sourceRevision } : {}),
    });
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    workspaces: group.workspaces.sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

export function cacheOwnershipLabel(group: CacheOwnershipGroup): string {
  const workspaceCount = group.workspaces.length;
  if (group.main && workspaceCount) {
    return `main · ${workspaceCount} ${workspaceCount === 1 ? "workspace" : "workspaces"}`;
  }
  if (group.main) return "main";
  return `${workspaceCount} ${workspaceCount === 1 ? "workspace" : "workspaces"}`;
}

function cacheEntrySetKey(entryIds: Set<string>): string | undefined {
  if (!entryIds.size) return undefined;
  return JSON.stringify([...entryIds].sort());
}
