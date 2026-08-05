import type { ManagedCacheEntry } from "@stoke/managed";

export const CACHE_NODE_WIDTH = 224;
export const CACHE_NODE_HEIGHT = 92;

const HORIZONTAL_GAP = 36;
const VERTICAL_GAP = 64;
const CANVAS_PADDING = 24;
const MINIMUM_WIDTH = 640;
const MINIMUM_HEIGHT = 452;

export type CacheGraphNode = {
  entry: ManagedCacheEntry;
  x: number;
  y: number;
};

export type CacheGraphEdge = {
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export type CacheGraphLayout = {
  width: number;
  height: number;
  nodes: CacheGraphNode[];
  edges: CacheGraphEdge[];
};

export function cacheInvalidationIds(
  entries: ManagedCacheEntry[],
  targetId: string,
): Set<string> {
  if (!entries.some((entry) => entry.id === targetId)) return new Set();
  const affected = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (affected.has(entry.id)) continue;
      if (entry.upstreamRunIds.some((id) => affected.has(id))) {
        affected.add(entry.id);
        changed = true;
      }
    }
  }
  return affected;
}

export function layoutCacheGraph(entries: ManagedCacheEntry[]): CacheGraphLayout {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const depthById = new Map<string, number>();

  const depthFor = (entry: ManagedCacheEntry, visiting = new Set<string>()): number => {
    const cached = depthById.get(entry.id);
    if (cached !== undefined) return cached;
    if (visiting.has(entry.id)) return 0;
    const nextVisiting = new Set(visiting).add(entry.id);
    const upstreamDepths = entry.upstreamRunIds
      .map((id) => byId.get(id))
      .filter((upstream): upstream is ManagedCacheEntry => Boolean(upstream))
      .map((upstream) => depthFor(upstream, nextVisiting) + 1);
    const depth = upstreamDepths.length ? Math.max(...upstreamDepths) : 0;
    depthById.set(entry.id, depth);
    return depth;
  };

  const layers = new Map<number, ManagedCacheEntry[]>();
  for (const entry of entries) {
    const depth = depthFor(entry);
    const layer = layers.get(depth) ?? [];
    layer.push(entry);
    layers.set(depth, layer);
  }
  const orderedLayers = [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, layer]) => layer.sort(compareEntries));
  const widestLayer = Math.max(1, ...orderedLayers.map((layer) => layer.length));
  const contentWidth = widestLayer * CACHE_NODE_WIDTH + (widestLayer - 1) * HORIZONTAL_GAP;
  const width = Math.max(MINIMUM_WIDTH, contentWidth + CANVAS_PADDING * 2);
  const height = Math.max(
    MINIMUM_HEIGHT,
    orderedLayers.length * CACHE_NODE_HEIGHT
      + Math.max(0, orderedLayers.length - 1) * VERTICAL_GAP
      + CANVAS_PADDING * 2,
  );

  const nodes = orderedLayers.flatMap((layer, layerIndex) => {
    const layerWidth = layer.length * CACHE_NODE_WIDTH + (layer.length - 1) * HORIZONTAL_GAP;
    const layerStart = (width - layerWidth) / 2;
    return layer.map((entry, entryIndex) => ({
      entry,
      x: layerStart + entryIndex * (CACHE_NODE_WIDTH + HORIZONTAL_GAP),
      y: CANVAS_PADDING + layerIndex * (CACHE_NODE_HEIGHT + VERTICAL_GAP),
    }));
  });
  const nodesById = new Map(nodes.map((node) => [node.entry.id, node]));
  const edges = nodes.flatMap((node) => node.entry.upstreamRunIds.flatMap((upstreamId) => {
    const upstream = nodesById.get(upstreamId);
    if (!upstream) return [];
    return [{
      fromId: upstreamId,
      toId: node.entry.id,
      fromX: upstream.x + CACHE_NODE_WIDTH / 2,
      fromY: upstream.y + CACHE_NODE_HEIGHT,
      toX: node.x + CACHE_NODE_WIDTH / 2,
      toY: node.y,
    }];
  }));

  return { width, height, nodes, edges };
}

function compareEntries(left: ManagedCacheEntry, right: ManagedCacheEntry): number {
  return left.workflow.localeCompare(right.workflow)
    || left.nodePath.localeCompare(right.nodePath)
    || left.createdAt.localeCompare(right.createdAt);
}
