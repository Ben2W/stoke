"use client";

import type { ManagedRun, ManagedRunEvent } from "@usestoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";
import { respondRunCapability } from "../../../../../lib/api-client.ts";
import { queryKeys } from "../../../../../lib/queries.ts";

export function RunCapabilityAction({ events, run }: { events: ManagedRunEvent[]; run: ManagedRun }) {
  const queryClient = useQueryClient();
  const [popupError, setPopupError] = useState<string>();
  const pending = pendingBrowserOpen(events);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending?.expiresAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [pending?.expiresAt]);
  const acknowledge = useMutation({
    mutationFn: (request: PendingBrowserOpen) =>
      respondRunCapability(run.id, request.requestId, { opened: true }),
    onSuccess: (event) => {
      queryClient.setQueryData<ManagedRunEvent[]>(queryKeys.runEvents(run.id), (current = []) => [
        ...current.filter((candidate) => candidate.id !== event.id),
        event,
      ].sort((left, right) => left.id - right.id));
    },
  });

  if (!pending || run.status !== "running") return null;
  const secondsRemaining = pending.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(pending.expiresAt) - now) / 1_000))
    : undefined;
  const expired = secondsRemaining === 0;

  const open = () => {
    acknowledge.reset();
    setPopupError(undefined);
    const target = window.open(pending.url, "_blank");
    if (!target) {
      setPopupError("Your browser blocked the new tab. Allow popups for Stoke and try again.");
      return;
    }
    target.opener = null;
    acknowledge.mutate(pending);
  };

  return (
    <div className="border-t border-zinc-100 bg-zinc-50/70 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-900">Preview ready</p>
          <p className="mt-1 truncate text-[11px] text-zinc-500">
            {expired
              ? "This request expired. The operation is stopping…"
              : `The operation will continue after you open this link${secondsRemaining === undefined ? "." : ` · ${secondsRemaining}s remaining`}`}
          </p>
          {popupError || acknowledge.isError ? (
            <p className="mt-1 text-[11px] text-red-600">{popupError ?? acknowledge.error?.message}</p>
          ) : null}
        </div>
        <button
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-zinc-950 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
          disabled={acknowledge.isPending || expired}
          onClick={open}
          type="button"
        >
          {acknowledge.isPending ? <CircleDashed className="animate-spin" size={13} /> : <ArrowUpRight size={13} />}
          {acknowledge.isPending ? "Acknowledging…" : expired ? "Expired" : pending.displayName}
        </button>
      </div>
    </div>
  );
}

export type PendingBrowserOpen = {
  requestId: string;
  url: string;
  displayName: string;
  expiresAt?: string;
};

export function pendingBrowserOpen(events: ManagedRunEvent[]): PendingBrowserOpen | undefined {
  const answered = new Set(events
    .filter((event) => event.data.type === "host.capability.response" && typeof event.data.requestId === "string")
    .map((event) => event.data.requestId as string));
  for (const event of [...events].reverse()) {
    if (event.data.type !== "host.capability.request" || event.data.capability !== "browser.open") continue;
    const requestId = typeof event.data.id === "string"
      ? event.data.id
      : typeof event.data.requestId === "string"
        ? event.data.requestId
        : undefined;
    const params = event.data.params;
    if (
      !requestId
      || answered.has(requestId)
      || !isRecord(params)
      || typeof params.url !== "string"
      || typeof params.displayName !== "string"
    ) continue;
    return {
      requestId,
      url: params.url,
      displayName: params.displayName,
      ...(typeof event.data.expiresAt === "string" ? { expiresAt: event.data.expiresAt } : {}),
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
