"use client";

import type { ManagedRun } from "@usestoke/managed";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryKeys } from "../../../lib/queries.ts";

export function ActiveRunObservers({ runs }: { runs: ManagedRun[] }) {
  const queryClient = useQueryClient();
  const previousStatuses = useRef(new Map(runs.map((run) => [run.id, run.status])));

  useEffect(() => {
    const nextStatuses = new Map(runs.map((run) => [run.id, run.status]));
    for (const run of runs) {
      if (previousStatuses.current.get(run.id) === "running" && run.status !== "running") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectCache(run.projectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(run.projectId) });
      }
    }
    previousStatuses.current = nextStatuses;
  }, [queryClient, runs]);

  return null;
}
