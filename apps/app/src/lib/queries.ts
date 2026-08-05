import { queryOptions } from "@tanstack/react-query";
import {
  getCheckouts,
  getCurrentUser,
  getProjects,
  getRunEvents,
  getRuns,
} from "./api-client.ts";

export const queryKeys = {
  currentUser: ["current-user"] as const,
  projects: ["projects"] as const,
  checkouts: ["checkouts"] as const,
  runs: ["runs"] as const,
  runEvents: (runId: string) => ["runs", runId, "events"] as const,
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
  refetchInterval: (query) =>
    query.state.data?.some((run) => run.status === "running") ? 5_000 : false,
});

export function runEventsQuery(runId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.runEvents(runId ?? "none"),
    queryFn: () => getRunEvents(runId!),
    enabled: Boolean(runId),
  });
}
