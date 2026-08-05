"use client";

import type { ManagedCacheEntry } from "@stoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { clearProjectCache, invalidateProjectCacheEntry } from "../../lib/api-client.ts";
import { projectCacheQuery, queryKeys } from "../../lib/queries.ts";

export function ProjectCache({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const cache = useQuery(projectCacheQuery(projectId));
  const [confirmClear, setConfirmClear] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.projectCache(projectId) });
  const invalidate = useMutation({
    mutationFn: (entry: ManagedCacheEntry) => invalidateProjectCacheEntry(projectId, {
      scope: entry.scope,
      entryId: entry.id,
    }),
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: () => clearProjectCache(projectId),
    onSuccess: () => {
      setConfirmClear(false);
      void refresh();
    },
  });
  const entries = cache.data?.entries ?? [];

  return (
    <section className="mt-8" aria-labelledby="cache-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium" id="cache-heading">Cache</h2>
          <p className="mt-1 text-xs text-zinc-500">Shared node results used by local and Vercel Sandbox runs.</p>
        </div>
        {entries.length ? (
          <button
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition ${confirmClear ? "border-red-200 bg-red-50 text-red-700" : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"}`}
            disabled={clear.isPending}
            onClick={() => confirmClear ? clear.mutate() : setConfirmClear(true)}
            onBlur={() => setConfirmClear(false)}
            type="button"
          >
            <Trash2 size={12} /> {clear.isPending ? "Clearing…" : confirmClear ? "Confirm clear" : "Clear all"}
          </button>
        ) : null}
      </div>

      {cache.isPending ? (
        <div className="h-28 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      ) : cache.isError ? (
        <button className="grid h-28 w-full place-items-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-500" onClick={() => void cache.refetch()} type="button">Could not load cache. Try again.</button>
      ) : entries.length ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs">
          <ul className="divide-y divide-zinc-100">
            {entries.map((entry) => (
              <li className={`flex items-center gap-3 px-4 py-3 ${entry.invalidated ? "bg-zinc-50/70 opacity-65" : ""}`} key={`${entry.scope}:${entry.id}`}>
                <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Database size={14} /></div>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs font-medium text-zinc-800">{entry.nodePath}</strong>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-400">{entry.workflow} · {entry.scope} · {relativeTime(entry.createdAt)}</span>
                </span>
                {entry.invalidated ? <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500">Invalidated</span> : <button
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"
                  disabled={invalidate.isPending}
                  onClick={() => invalidate.mutate(entry)}
                  title="Invalidate this entry and dependent results"
                  type="button"
                ><RotateCcw size={12} /> Invalidate</button>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-7 text-center">
          <Database className="mx-auto text-zinc-300" size={20} />
          <p className="mt-2 text-xs text-zinc-500">No reusable node results yet. Plan or apply this project to populate the shared cache.</p>
        </div>
      )}
      {invalidate.isError || clear.isError ? <p className="mt-2 text-xs text-red-600">{(invalidate.error ?? clear.error)?.message}</p> : null}
    </section>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}
