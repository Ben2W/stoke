import type { ManagedCacheEntry } from "@stoke/managed";
import { Database, RotateCcw, Waypoints } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CACHE_NODE_HEIGHT,
  CACHE_NODE_WIDTH,
  cacheInvalidationIds,
  layoutCacheGraph,
} from "./cache-graph-layout.ts";

export function CacheGraph({
  entries,
  invalidatingId,
  onInvalidate,
}: {
  entries: ManagedCacheEntry[];
  invalidatingId?: string;
  onInvalidate(entry: ManagedCacheEntry): void;
}) {
  const graph = useMemo(() => layoutCacheGraph(entries), [entries]);
  const [selectedId, setSelectedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const previewId = hoveredId ?? selectedId;
  const previewIds = useMemo(
    () => previewId ? cacheInvalidationIds(entries, previewId) : new Set<string>(),
    [entries, previewId],
  );
  const impactById = useMemo(() => new Map(entries.map((entry) => [
    entry.id,
    [...cacheInvalidationIds(entries, entry.id)]
      .filter((id) => !entries.find((candidate) => candidate.id === id)?.invalidated)
      .length,
  ])), [entries]);

  useEffect(() => {
    if (selectedId && entries.find((entry) => entry.id === selectedId)?.invalidated) {
      setSelectedId(undefined);
    }
  }, [entries, selectedId]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs">
      <div className="flex flex-col justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500">
            <Waypoints size={15} />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-800">Dependency graph</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Select an invalidation to preview its downstream impact.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-zinc-300 bg-white" /> Cached</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-amber-300 bg-amber-50" /> Invalidated next</span>
        </div>
      </div>

      <div className="overflow-x-auto bg-zinc-50/50">
        <div className="relative" style={{ height: graph.height, width: graph.width }}>
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" height={graph.height} width={graph.width}>
            <defs>
              <marker id="cache-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
                <path d="M0,0 L6,3 L0,6 Z" fill="#d4d4d8" />
              </marker>
              <marker id="cache-arrow-active" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
                <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const active = previewIds.has(edge.fromId) && previewIds.has(edge.toId);
              const middleY = (edge.fromY + edge.toY) / 2;
              return (
                <path
                  d={`M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${middleY}, ${edge.toX} ${middleY}, ${edge.toX} ${edge.toY}`}
                  fill="none"
                  key={`${edge.fromId}:${edge.toId}`}
                  markerEnd={active ? "url(#cache-arrow-active)" : "url(#cache-arrow)"}
                  stroke={active ? "#f59e0b" : "#d4d4d8"}
                  strokeWidth={active ? 2 : 1.5}
                />
              );
            })}
          </svg>

          {graph.nodes.map(({ entry, x, y }) => {
            const target = previewId === entry.id;
            const affected = previewIds.has(entry.id);
            const dimmed = Boolean(previewId) && !affected;
            const impact = impactById.get(entry.id) ?? 0;
            return (
              <article
                aria-label={`${entry.nodePath} cache entry`}
                className={`absolute flex flex-col rounded-lg border p-3 shadow-sm transition-all ${entry.invalidated ? "border-dashed border-zinc-200 bg-zinc-50 text-zinc-400" : target ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100" : affected ? "border-amber-200 bg-amber-50/70" : "border-zinc-200 bg-white"} ${dimmed ? "opacity-40" : "opacity-100"}`}
                key={`${entry.scope}:${entry.id}`}
                style={{ height: CACHE_NODE_HEIGHT, left: x, top: y, width: CACHE_NODE_WIDTH }}
              >
                <div className="flex items-start gap-2.5">
                  <Database className={entry.invalidated ? "text-zinc-300" : affected ? "text-amber-600" : "text-zinc-400"} size={14} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-medium text-zinc-800">{entry.nodePath}</h3>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-400">{entry.workflow} · {entry.scope}</p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2">
                  {entry.invalidated ? (
                    <span className="text-[10px] font-medium text-zinc-400">Invalidated</span>
                  ) : (
                    <button
                      aria-pressed={selectedId === entry.id}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition ${selectedId === entry.id ? "bg-amber-600 text-white hover:bg-amber-700" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}`}
                      disabled={Boolean(invalidatingId)}
                      onBlur={() => setHoveredId(undefined)}
                      onClick={() => {
                        if (selectedId === entry.id) onInvalidate(entry);
                        else setSelectedId(entry.id);
                      }}
                      onFocus={() => setHoveredId(entry.id)}
                      onMouseEnter={() => setHoveredId(entry.id)}
                      onMouseLeave={() => setHoveredId(undefined)}
                      type="button"
                    >
                      <RotateCcw className={invalidatingId === entry.id ? "animate-spin" : ""} size={10} />
                      {invalidatingId === entry.id
                        ? "Invalidating…"
                        : selectedId === entry.id ? `Confirm ${impact}` : "Invalidate"}
                    </button>
                  )}
                  <span className="shrink-0 text-[10px] text-zinc-400">
                    {impact > 1 && !entry.invalidated ? `+${impact - 1} downstream` : relativeTime(entry.createdAt)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CacheGraphSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex h-14 items-center gap-3 border-b border-zinc-100 px-4">
        <div className="size-8 animate-pulse rounded-md bg-zinc-100" />
        <div className="space-y-2"><div className="h-3 w-28 animate-pulse rounded bg-zinc-200" /><div className="h-2.5 w-64 max-w-[60vw] animate-pulse rounded bg-zinc-100" /></div>
      </div>
      <div className="flex h-[28rem] flex-col items-center justify-center gap-3 bg-zinc-50/50">
        {["w-44", "w-52", "w-44"].map((width, index) => (
          <div className="contents" key={width + index}>
            {index ? <div className="h-5 w-px bg-zinc-200" /> : null}
            <div className={`h-20 animate-pulse rounded-lg border border-zinc-200 bg-white ${width}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}
