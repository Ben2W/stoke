"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getRunSocketUrl } from "./api-client.ts";
import { queryKeys } from "./queries.ts";
import { parseRunNotification } from "./run-notification.ts";

export function useRunNotifications(runId: string | undefined, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const refresh = (changedRunId?: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs, exact: true });
      if (changedRunId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.runEvents(changedRunId),
          exact: true,
        });
      }
    };
    const scheduleReconnect = () => {
      if (closed || reconnect) return;
      reconnect = setTimeout(() => {
        reconnect = undefined;
        void connect();
      }, 1_000);
    };
    const connect = async () => {
      try {
        const socketUrl = await getRunSocketUrl(runId);
        if (closed) return;
        const next = new WebSocket(socketUrl);
        socket = next;
        next.addEventListener("message", (message) => {
          try {
            const notification = parseRunNotification(JSON.parse(String(message.data)));
            if (notification?.type === "run.changed") refresh(notification.runId);
            if (notification?.type === "runs.changed") refresh();
          } catch {
            // Reconnects always trigger an authoritative HTTP catch-up.
          }
        });
        next.addEventListener("close", () => {
          if (socket === next) socket = undefined;
          scheduleReconnect();
        });
        next.addEventListener("error", () => next.close());
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
  }, [enabled, queryClient, runId]);
}
