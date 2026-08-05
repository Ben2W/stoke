"use client";

import type { ManagedProject, ManagedRun, ManagedRunEvent } from "@stoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRunTicket } from "../../lib/api-client.ts";
import { queryKeys, runEventsQuery, runsQuery } from "../../lib/queries.ts";
import { RunEventList } from "./run-event-list.tsx";
import { RunList } from "./run-list.tsx";

export function RunActivity({ project }: { project: ManagedProject }) {
  const queryClient = useQueryClient();
  const runsResult = useQuery(runsQuery);
  const runs = (runsResult.data ?? []).filter((run) => run.projectId === project.id);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId),
    [runs, selectedRunId],
  );
  const eventsResult = useQuery(runEventsQuery(selectedRunId));
  const { mutateAsync: createTicketForRun } = useMutation({ mutationFn: createRunTicket });

  useEffect(() => {
    const activeRun = runs.find((run) => run.status === "running");
    if (activeRun && selectedRun?.status !== "running") {
      setSelectedRunId(activeRun.id);
      return;
    }
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(activeRun?.id ?? runs[0]?.id);
  }, [runs, selectedRun?.status, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || selectedRun?.status !== "running") return;
    let disposed = false;
    let terminal = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    const mergeEvents = (next: ManagedRunEvent[]) => {
      if (disposed) return;
      queryClient.setQueryData<ManagedRunEvent[]>(queryKeys.runEvents(selectedRunId), (current = []) => {
        const merged = new Map(current.map((event) => [event.id, event]));
        for (const event of next) merged.set(event.id, event);
        return [...merged.values()].sort((left, right) => left.id - right.id);
      });
    };

    const updateRun = (run: ManagedRun) => {
      if (disposed) return;
      terminal = run.status !== "running";
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (current = []) =>
        current.map((candidate) => candidate.id === run.id ? run : candidate));
    };

    const connect = async () => {
      if (disposed || terminal) return;
      try {
        const socketUrl = await createTicketForRun(selectedRunId);
        if (disposed) return;
        socket = new WebSocket(socketUrl);
        socket.addEventListener("message", (message) => {
          const data = JSON.parse(String(message.data)) as {
            type?: string;
            events?: ManagedRunEvent[];
            run?: ManagedRun;
          };
          if (data.type === "events" && data.events) mergeEvents(data.events);
          if (data.type === "run" && data.run) updateRun(data.run);
        });
        socket.addEventListener("close", () => {
          if (!disposed && !terminal) reconnect = setTimeout(connect, 1_500);
        });
      } catch {
        if (!disposed && !terminal) reconnect = setTimeout(connect, 2_500);
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
  }, [createTicketForRun, queryClient, selectedRun?.status, selectedRunId]);

  return (
    <section className="mt-8" aria-labelledby="activity-heading">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium" id="activity-heading">Runs</h2>
          <p className="mt-1 text-xs text-zinc-500">The same live execution stream shown by the CLI.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400"><span className="size-1.5 rounded-full bg-emerald-500" /> Postgres + WebSocket</span>
      </div>

      {runs.length && selectedRun ? (
        <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs lg:grid-cols-[20rem_1fr]">
          <div className="border-b border-zinc-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-zinc-100 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Recent runs</div>
            <RunList onSelect={setSelectedRunId} projects={[project]} runs={runs} selectedRunId={selectedRunId} />
          </div>
          {eventsResult.isPending ? (
            <div className="grid min-h-72 place-items-center text-xs text-zinc-400">Loading run events…</div>
          ) : eventsResult.isError ? (
            <button className="min-h-72 text-sm text-zinc-500" onClick={() => void eventsResult.refetch()} type="button">Could not load events. Try again.</button>
          ) : (
            <RunEventList events={eventsResult.data} run={selectedRun} />
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
          <Activity className="mx-auto text-zinc-300" size={21} />
          <p className="mt-3 text-sm font-medium text-zinc-800">No managed runs yet</p>
          <p className="mt-1 text-xs text-zinc-500">Run <code className="rounded bg-zinc-100 px-1.5 py-0.5">stoke apply</code> in a linked checkout.</p>
        </div>
      )}
    </section>
  );
}
