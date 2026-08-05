import type { ManagedRun, ManagedRunEvent } from "@stoke/managed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRunTicket } from "../../lib/api-client.ts";
import { queryKeys, runEventsQuery, runsQuery } from "../../lib/queries.ts";

export function useRunObserver(runId: string | undefined) {
  const queryClient = useQueryClient();
  const runsResult = useQuery(runsQuery);
  const eventsResult = useQuery(runEventsQuery(runId));
  const run = runsResult.data?.find((candidate) => candidate.id === runId);
  const { mutateAsync: createTicketForRun } = useMutation({ mutationFn: createRunTicket });

  useEffect(() => {
    if (!runId || run?.status !== "running") return;
    let disposed = false;
    let terminal = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    const mergeEvents = (next: ManagedRunEvent[]) => {
      if (disposed) return;
      queryClient.setQueryData<ManagedRunEvent[]>(queryKeys.runEvents(runId), (current = []) => {
        const merged = new Map(current.map((event) => [event.id, event]));
        for (const event of next) merged.set(event.id, event);
        return [...merged.values()].sort((left, right) => left.id - right.id);
      });
    };

    const updateRun = (next: ManagedRun) => {
      if (disposed) return;
      terminal = next.status !== "running";
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (current = []) => {
        const found = current.some((candidate) => candidate.id === next.id);
        return found
          ? current.map((candidate) => candidate.id === next.id ? next : candidate)
          : [next, ...current];
      });
      if (terminal) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectCache(next.projectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(next.projectId) });
      }
    };

    const connect = async () => {
      if (disposed || terminal) return;
      try {
        const socketUrl = await createTicketForRun(runId);
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
  }, [createTicketForRun, queryClient, run?.status, runId]);

  return { eventsResult, run, runsResult };
}
