"use client";

import type { ManagedCacheEntry, ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { Check, CircleDashed, Database, RotateCcw, Waypoints } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { shortFingerprint } from "../../../../lib/fingerprint.ts";
import { projectCacheGraph } from "./cache-graph-model.ts";
import { groupCacheOwnership } from "./cache-ownership.ts";
import {
  CACHE_NODE_HEIGHT,
  CACHE_NODE_WIDTH,
  cacheInvalidationIds,
  layoutCacheGraph,
} from "./cache-graph-layout.ts";
import { CacheWorkflowVersions } from "./cache-workflow-versions.tsx";
import type { RunTaskFlow, RunTaskStatus } from "../runs/_components/run-task-flow.ts";

export function CacheGraph({
  activeFlow,
  activeRun,
  entries,
  invalidatingId,
  onInvalidate,
  plannedFlow,
  plannedRun,
  projectSlug,
  workspaces,
}: {
  activeFlow?: RunTaskFlow;
  activeRun?: ManagedRun;
  entries: ManagedCacheEntry[];
  invalidatingId?: string;
  onInvalidate(entry: ManagedCacheEntry): void;
  plannedFlow?: RunTaskFlow;
  plannedRun?: ManagedRun;
  projectSlug: string;
  workspaces: ManagedWorkspace[];
}) {
  const workspaceEntryIds = useMemo(
    () => new Set(workspaces.flatMap((workspace) => workspace.cacheEntryIds ?? [])),
    [workspaces],
  );
  const model = useMemo(() => projectCacheGraph(
    entries,
    plannedFlow && plannedRun ? { flow: plannedFlow, run: plannedRun } : undefined,
    activeFlow && activeRun ? { flow: activeFlow, run: activeRun } : undefined,
    workspaceEntryIds,
  ), [activeFlow, activeRun, entries, plannedFlow, plannedRun, workspaceEntryIds]);
  const graph = useMemo(() => layoutCacheGraph(model.entries), [model.entries]);
  const ownershipGroups = useMemo(
    () => groupCacheOwnership(model.mainEntryIds, workspaces, model.entries),
    [model.entries, model.mainEntryIds, workspaces],
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedOwnershipKey, setSelectedOwnershipKey] = useState<string>();
  const [hoveredOwnershipKey, setHoveredOwnershipKey] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const highlightedOwnership = ownershipGroups.find((group) => group.key === hoveredOwnershipKey);
  const highlightedOwnershipIds = highlightedOwnership?.entryIds;
  const previewId = hoveredId ?? selectedId;
  const previewIds = useMemo(
    () => previewId ? cacheInvalidationIds(model.entries, previewId) : new Set<string>(),
    [model.entries, previewId],
  );
  const impactById = useMemo(() => new Map(model.entries.map((entry) => [
    entry.id,
    [...cacheInvalidationIds(model.entries, entry.id)]
      .filter((id) => !model.entries.find((candidate) => candidate.id === id)?.invalidated)
      .length,
  ])), [model.entries]);

  useEffect(() => {
    if (selectedId && !entries.some((entry) => entry.id === selectedId)) {
      setSelectedId(undefined);
    }
  }, [entries, selectedId]);

  const displayRun = activeRun ?? plannedRun;
  const displayFlow = activeRun ? activeFlow : plannedFlow;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs">
      <div className="flex flex-col justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500">
            <Waypoints size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-zinc-800">Dependency graph</p>
              {displayRun ? <RunIndicator flow={displayFlow} run={displayRun} /> : null}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">Plan builds this graph. Apply plays task state and output across the same nodes.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={11} /> Cached</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-amber-300 bg-amber-50" /> Invalidated next</span>
        </div>
      </div>

      <div className="flex flex-col bg-zinc-50/50 lg:flex-row">
        <CacheWorkflowVersions
          expandedKey={selectedOwnershipKey}
          groups={ownershipGroups}
          highlightedKey={hoveredOwnershipKey}
          onExpandedChange={setSelectedOwnershipKey}
          onHighlightedChange={setHoveredOwnershipKey}
          projectSlug={projectSlug}
        />
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" onMouseDown={() => setSelectedOwnershipKey(undefined)} style={{ height: graph.height, width: graph.width }}>
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
                const workflowActive = highlightedOwnershipIds?.has(edge.fromId) && highlightedOwnershipIds.has(edge.toId);
                const workflowDimmed = Boolean(highlightedOwnershipIds) && !workflowActive;
                const middleY = (edge.fromY + edge.toY) / 2;
                return (
                  <path
                    d={`M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${middleY}, ${edge.toX} ${middleY}, ${edge.toX} ${edge.toY}`}
                    fill="none"
                    key={`${edge.fromId}:${edge.toId}`}
                    markerEnd={active ? "url(#cache-arrow-active)" : "url(#cache-arrow)"}
                    opacity={workflowDimmed ? 0.18 : 1}
                    stroke={active ? "#f59e0b" : workflowActive ? highlightedOwnership?.main ? "#60a5fa" : "#a78bfa" : "#d4d4d8"}
                    strokeWidth={active || workflowActive ? 2 : 1.5}
                    style={{ transition: "opacity 150ms ease, stroke 150ms ease" }}
                  />
                );
              })}
            </svg>

            {graph.nodes.map(({ entry, x, y }) => {
              const target = previewId === entry.id;
              const affected = previewIds.has(entry.id);
              const invalidationDimmed = Boolean(previewId) && !affected;
              const workflowHighlighted = highlightedOwnershipIds?.has(entry.id);
              const workflowDimmed = Boolean(highlightedOwnershipIds) && !workflowHighlighted;
              const impact = impactById.get(entry.id) ?? 0;
              const activity = model.activities.get(entry.id);
              const live = activity?.status === "running";
              const planned = activity?.status === "pending";
              const completed = activity?.status === "completed";
              const cached = !entry.invalidated && (activity?.status === "cached" || !activity);
              return (
                <article
                  aria-label={`${entry.nodePath} cache entry`}
                  className={`absolute flex flex-col rounded-lg border p-3 shadow-sm transition-all ${live ? "border-blue-400 bg-blue-50/60 ring-2 ring-blue-100" : completed ? "border-emerald-300 bg-emerald-50/40" : planned ? "border-dashed border-amber-300 bg-amber-50/50" : target ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100" : affected ? "border-amber-200 bg-amber-50/70" : cached ? "border-emerald-300 bg-emerald-50/40" : entry.invalidated ? "border-dashed border-zinc-300 bg-zinc-50" : "border-zinc-200 bg-white"} ${workflowHighlighted && !live && !target ? highlightedOwnership?.main ? "ring-2 ring-blue-200" : "ring-2 ring-violet-200" : ""} ${invalidationDimmed || workflowDimmed ? "opacity-30" : "opacity-100"}`}
                  key={entry.id}
                  style={{ height: CACHE_NODE_HEIGHT, left: x, top: y, width: CACHE_NODE_WIDTH }}
                >
                  <div className="flex items-start gap-2.5">
                    {live ? <CircleDashed className="animate-spin text-blue-600" size={14} /> : completed || cached ? <Check className="text-emerald-600" size={14} /> : <Database className={planned ? "text-amber-500" : affected ? "text-amber-600" : "text-zinc-400"} size={14} />}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-xs font-medium text-zinc-800">{entry.nodePath}</h3>
                      <p className="mt-0.5 truncate text-[10px] text-zinc-400">
                        <code className="font-mono text-zinc-500" title={entry.fingerprint}>{shortFingerprint(entry.fingerprint)}</code> · {entry.workflow} · {activity?.synthetic ? "planned" : entry.scope}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    {activity ? (
                      <NodeActivity status={activity.status} />
                    ) : entry.invalidated ? (
                      <span className="text-[10px] font-medium text-zinc-400">Invalidated</span>
                    ) : (
                      <button
                        aria-pressed={selectedId === entry.id}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition ${selectedId === entry.id ? "bg-amber-600 text-white hover:bg-amber-700" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}`}
                        disabled={Boolean(invalidatingId) || activeRun?.status === "running"}
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
                      {activity?.status === "running" ? "now" : impact > 1 && !activity?.synthetic ? `+${impact - 1} downstream` : relativeTime(entry.createdAt)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
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

function RunIndicator({ flow, run }: { flow?: RunTaskFlow; run: ManagedRun }) {
  const fingerprint = shortFingerprint(run.fingerprint);
  const settingUp = run.status === "running" && (!flow || flow.tasks.length === 0);
  const pending = flow?.tasks.filter((task) => task.status === "pending").length ?? 0;
  const label = settingUp
    ? `Setting up ${fingerprint}`
    : run.status === "running"
      ? `${run.operation === "apply" ? "Applying" : "Planning"} ${fingerprint}`
      : run.operation === "plan"
        ? `Plan ${fingerprint} · ${pending} ${pending === 1 ? "task" : "tasks"} will run`
        : `${run.operation} ${fingerprint}`;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-medium ${run.status === "running" ? "bg-blue-50 text-blue-700" : "bg-zinc-100 text-zinc-600"}`} title={run.fingerprint}>
      {run.status === "running" ? <span className="size-1.5 animate-pulse rounded-full bg-blue-500" /> : null}
      {label}
    </span>
  );
}

function NodeActivity({ status }: { status: RunTaskStatus }) {
  const label = status === "pending"
    ? "Will run"
    : status === "running"
      ? "Running…"
      : status === "cached"
        ? "Cached"
        : status === "failed"
          ? "Failed"
          : "Completed";
  const color = status === "running"
    ? "text-blue-700"
    : status === "pending"
      ? "text-amber-700"
      : status === "completed" || status === "cached"
        ? "text-emerald-700"
        : status === "failed"
          ? "text-red-700"
          : "text-zinc-500";
  return <span className={`text-[10px] font-medium ${color}`}>{label}</span>;
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}
