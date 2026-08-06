"use client";

import type { ManagedProject, ManagedWorkspace } from "@usestoke/managed";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { projectCacheQuery, runsQuery } from "../../../../../../lib/queries.ts";
import { latestRemoteMainRun } from "../../../_components/cache-main-run.ts";
import { projectCacheGraph } from "../../../_components/cache-graph-model.ts";
import { workspaceMatchesWorkflowVersion } from "../../../_components/cache-ownership.ts";
import { projectRunTaskFlow } from "../../../runs/_components/run-task-flow.ts";
import { useRunObserver } from "../../../runs/_components/use-run-observer.ts";

export function useWorkspaceOperationCompatibility(
  project: ManagedProject,
  workspace: ManagedWorkspace,
): { unavailable: boolean; checking: boolean } {
  const cache = useQuery(projectCacheQuery(project.id));
  const runs = useQuery(runsQuery);
  const headRun = latestRemoteMainRun(
    (runs.data ?? []).filter((run) => run.projectId === project.id),
  );
  const headEvents = useRunObserver(headRun?.id);
  const headFlow = useMemo(
    () => headRun ? projectRunTaskFlow(headEvents.eventsResult.data ?? [], headRun) : undefined,
    [headEvents.eventsResult.data, headRun],
  );
  const mainEntryIds = useMemo(
    () => projectCacheGraph(
      cache.data?.entries ?? [],
      headRun && headFlow ? { flow: headFlow, run: headRun } : undefined,
    ).mainEntryIds,
    [cache.data?.entries, headFlow, headRun],
  );
  const match = workspaceMatchesWorkflowVersion(workspace.cacheEntryIds, mainEntryIds);

  return {
    unavailable: match === false,
    checking: cache.isPending || runs.isPending || Boolean(headRun && headEvents.eventsResult.isPending),
  };
}
