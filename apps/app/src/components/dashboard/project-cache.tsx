"use client";

import type { ManagedCacheEntry } from "@stoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Trash2 } from "lucide-react";
import { useState } from "react";
import { clearProjectCache, invalidateProjectCacheEntry } from "../../lib/api-client.ts";
import { projectCacheQuery, queryKeys } from "../../lib/queries.ts";
import { CacheGraph, CacheGraphSkeleton } from "./cache-graph.tsx";

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
          <p className="mt-1 text-xs text-zinc-500">Shared node results and their cascading dependencies across local and Vercel Sandbox runs.</p>
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
        <CacheGraphSkeleton />
      ) : cache.isError ? (
        <button className="grid h-28 w-full place-items-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-500" onClick={() => void cache.refetch()} type="button">Could not load cache. Try again.</button>
      ) : entries.length ? (
        <CacheGraph
          entries={entries}
          invalidatingId={invalidate.isPending ? invalidate.variables?.id : undefined}
          onInvalidate={(entry) => invalidate.mutate(entry)}
        />
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
