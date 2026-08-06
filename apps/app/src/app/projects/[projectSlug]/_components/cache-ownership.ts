import type { ManagedCacheEntry, ManagedWorkspace } from "@usestoke/managed";

type WorkspaceCacheOwner = Pick<
  ManagedWorkspace,
  "cacheEntryIds" | "createdFrom" | "id" | "name" | "sourceRevision"
>;

export type CacheOwnershipGroup = {
  entryIds: Set<string>;
  fingerprint: string;
  key: string;
  main: boolean;
  workspaces: Array<{
    createdFrom: ManagedWorkspace["createdFrom"];
    id: string;
    name: string;
    revision?: string;
  }>;
};

export function groupCacheOwnership(
  mainEntryIds: Set<string>,
  workspaces: WorkspaceCacheOwner[],
  entries: ManagedCacheEntry[],
): CacheOwnershipGroup[] {
  const groups = new Map<string, CacheOwnershipGroup>();
  const mainKey = cacheEntrySetKey(mainEntryIds);
  if (mainKey) {
    groups.set(mainKey, {
      entryIds: new Set(mainEntryIds),
      fingerprint: workflowVersionFingerprint(mainEntryIds, entries),
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
      fingerprint: workflowVersionFingerprint(entryIds, entries),
      key,
      main: false,
      workspaces: [],
    };
    group.workspaces.push({
      createdFrom: workspace.createdFrom,
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
    return `Main · ${workspaceCount} ${workspaceCount === 1 ? "workspace" : "workspaces"}`;
  }
  if (group.main) return "Main";
  return `${cacheOwnershipOriginLabel(group)} · ${workspaceCount} ${workspaceCount === 1 ? "workspace" : "workspaces"}`;
}

export function cacheOwnershipOriginLabel(group: CacheOwnershipGroup): string {
  if (group.main) return "Main";
  const revisions = new Set(group.workspaces.flatMap((workspace) => workspace.revision ? [workspace.revision] : []));
  if (revisions.size === 1) return `Checkpoint ${[...revisions][0]!.slice(0, 7)}`;
  if (revisions.size > 1) return `${revisions.size} checkpoints`;
  return "Unversioned checkpoint";
}

export function cacheOwnershipSourceLabel(group: CacheOwnershipGroup): string {
  if (group.main) return "Remote repository";
  const checkoutSources = group.workspaces
    .map((workspace) => workspace.createdFrom)
    .filter((source): source is Extract<ManagedWorkspace["createdFrom"], { kind: "checkout" }> =>
      source.kind === "checkout"
    );
  if (checkoutSources.length === group.workspaces.length) {
    const devices = new Set(checkoutSources.map((source) => source.deviceName));
    return devices.size === 1 ? [...devices][0]! : "Local checkouts";
  }
  if (checkoutSources.length === 0) return "Dashboard";
  return "Mixed sources";
}

export function workflowVersionFingerprint(
  entryIds: Set<string>,
  entries: ManagedCacheEntry[],
): string {
  const values = entries
    .filter((entry) => entryIds.has(entry.id))
    .sort((left, right) => left.nodePath.localeCompare(right.nodePath) || left.id.localeCompare(right.id))
    .map((entry) => `${entry.nodePath}:${entry.fingerprint}`);
  return `workflow:${fnv1a64(values.join("\n"))}`;
}

export function workspaceMatchesWorkflowVersion(
  workspaceEntryIds: readonly string[] | undefined,
  workflowEntryIds: Set<string>,
): boolean | undefined {
  if (!workspaceEntryIds?.length || !workflowEntryIds.size) return undefined;
  if (workspaceEntryIds.length !== workflowEntryIds.size) return false;
  return workspaceEntryIds.every((entryId) => workflowEntryIds.has(entryId));
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function cacheEntrySetKey(entryIds: Set<string>): string | undefined {
  if (!entryIds.size) return undefined;
  return JSON.stringify([...entryIds].sort());
}
