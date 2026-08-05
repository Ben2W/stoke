import { queryOptions } from "@tanstack/react-query";
import {
  getCheckouts,
  getCurrentUser,
  getProjects,
  getProjectCache,
  getProjectWorkspaces,
  getRunEvents,
  getRuns,
} from "./api-client.ts";

export const queryKeys = {
  currentUser: ["current-user"] as const,
  projects: ["projects"] as const,
  checkouts: ["checkouts"] as const,
  runs: ["runs"] as const,
  runEvents: (runId: string) => ["runs", runId, "events"] as const,
  projectWorkspaces: (projectId: string) => ["projects", projectId, "workspaces"] as const,
  projectCache: (projectId: string) => ["projects", projectId, "cache"] as const,
  deviceAuthorization: (userCode: string) => ["device-authorization", userCode] as const,
};

export const currentUserQuery = queryOptions({
  queryKey: queryKeys.currentUser,
  queryFn: getCurrentUser,
  staleTime: 30_000,
  retry: false,
});

export const projectsQuery = queryOptions({
  queryKey: queryKeys.projects,
  queryFn: getProjects,
  staleTime: 10_000,
});

export const checkoutsQuery = queryOptions({
  queryKey: queryKeys.checkouts,
  queryFn: getCheckouts,
  staleTime: 10_000,
});

export const runsQuery = queryOptions({
  queryKey: queryKeys.runs,
  queryFn: getRuns,
  refetchInterval: 3_000,
});

export function runEventsQuery(runId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.runEvents(runId ?? "none"),
    queryFn: () => getRunEvents(runId!),
    enabled: Boolean(runId),
  });
}

export function projectWorkspacesQuery(projectId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.projectWorkspaces(projectId ?? "none"),
    queryFn: () => getProjectWorkspaces(projectId!),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  });
}

export function projectCacheQuery(projectId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.projectCache(projectId ?? "none"),
    queryFn: () => getProjectCache(projectId!),
    enabled: Boolean(projectId),
  });
}
