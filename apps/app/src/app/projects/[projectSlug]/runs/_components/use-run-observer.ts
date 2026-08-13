import { useQuery } from "@tanstack/react-query";
import { runEventsQuery, runsQuery } from "../../../../../lib/queries.ts";

export function useRunObserver(runId: string | undefined) {
  const runsResult = useQuery(runsQuery);
  const run = runsResult.data?.find((candidate) => candidate.id === runId);
  const eventsResult = useQuery(runEventsQuery(runId));

  return { eventsResult, run, runsResult };
}
