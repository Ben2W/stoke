"use client";

import type { ManagedRun } from "@usestoke/managed";
import { useRunObserver } from "./use-run-observer.ts";

export function ActiveRunObservers({ runs }: { runs: ManagedRun[] }) {
  return runs
    .filter((run) => run.status === "running")
    .map((run) => <ActiveRunObserver key={run.id} runId={run.id} />);
}

function ActiveRunObserver({ runId }: { runId: string }) {
  useRunObserver(runId);
  return null;
}
