"use client";

import { useQuery } from "@tanstack/react-query";
import { checkoutsQuery } from "../../../../lib/queries.ts";
import { ProjectDetail } from "./project-detail.tsx";
import { RouteError, RouteLoading, RouteNotFound } from "../../_components/route-status.tsx";
import { useDashboardProject } from "../../_components/use-dashboard-project.ts";

export function ProjectPage({ projectSlug }: { projectSlug: string }) {
  const { project, projects } = useDashboardProject(projectSlug);
  const checkouts = useQuery(checkoutsQuery);

  if (projects.isPending || checkouts.isPending) return <RouteLoading />;
  const error = projects.error ?? checkouts.error;
  if (error) return <RouteError message="Could not load this project" onRetry={() => void Promise.all([projects.refetch(), checkouts.refetch()])} />;
  if (!project) return <RouteNotFound resource="Project" />;

  return (
    <ProjectDetail
      checkouts={(checkouts.data ?? []).filter((checkout) => checkout.projectId === project.id)}
      project={project}
    />
  );
}
