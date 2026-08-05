"use client";

import { useQuery } from "@tanstack/react-query";
import { projectsQuery } from "../../../lib/queries.ts";

export function useDashboardProject(projectSlug: string) {
  const projects = useQuery(projectsQuery);
  const project = projects.data?.find((candidate) => candidate.slug === projectSlug || candidate.id === projectSlug);
  return { project, projects };
}
