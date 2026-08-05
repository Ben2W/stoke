"use client";

import type { ManagedProject, ManagedRun, ManagedRunEvent } from "@stoke/managed";
import { Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RunEventList } from "./run-event-list.tsx";
import { RunList } from "./run-list.tsx";

export function RunActivity({ initialRuns, projects }: { initialRuns: ManagedRun[]; projects: ManagedProject[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState(() => initialRuns.find((run) => run.status === "running")?.id ?? initialRuns[0]?.id);
  const [events, setEvents] = useState<ManagedRunEvent[]>([]);
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId), [runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    let disposed = false;
    let terminal = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const abort = new AbortController();
    setEvents([]);

    const mergeEvents = (next: ManagedRunEvent[]) => {
      if (disposed) return;
      setEvents((current) => {
        const merged = new Map(current.map((event) => [event.id, event]));
        for (const event of next) merged.set(event.id, event);
        return [...merged.values()].sort((left, right) => left.id - right.id);
      });
    };

    const updateRun = (run: ManagedRun) => {
      if (disposed) return;
      terminal = run.status !== "running";
      setRuns((current) => current.map((candidate) => candidate.id === run.id ? run : candidate));
    };

    const loadEvents = async () => {
      const response = await fetch(`/api/v1/runs/${selectedRunId}/events`, { signal: abort.signal });
      if (!response.ok) throw new Error("Could not load run events");
      const data = await response.json() as { events: ManagedRunEvent[] };
      mergeEvents(data.events);
    };

    const connect = async () => {
      if (disposed || terminal) return;
      try {
        const response = await fetch(`/api/v1/runs/${selectedRunId}/ticket`, { method: "POST", signal: abort.signal });
        if (!response.ok) throw new Error("Could not create a live run ticket");
        const { socketUrl } = await response.json() as { socketUrl: string };
        socket = new WebSocket(socketUrl);
        socket.addEventListener("message", (message) => {
          const data = JSON.parse(String(message.data)) as { type?: string; events?: ManagedRunEvent[]; run?: ManagedRun };
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

    void loadEvents().catch(() => undefined);
    if (selectedRun?.status === "running") void connect();
    else terminal = true;

    return () => {
      disposed = true;
      abort.abort();
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
  }, [selectedRunId, selectedRun?.status]);

  return (
    <section className="mt-8" aria-labelledby="activity-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium" id="activity-heading">Run activity</h2>
        <span className="text-[11px] text-zinc-400">Live from managed apply</span>
      </div>

      {runs.length && selectedRun ? (
        <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs lg:grid-cols-[20rem_1fr]">
          <div className="border-b border-zinc-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-zinc-100 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Recent runs</div>
            <RunList onSelect={setSelectedRunId} projects={projects} runs={runs} selectedRunId={selectedRunId} />
          </div>
          <RunEventList events={events} run={selectedRun} />
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
