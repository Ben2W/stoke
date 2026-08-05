"use client";

import { RouteError, RouteLoading, RouteNotFound } from "../../../../_components/route-status.tsx";
import { useDashboardProject } from "../../../../_components/use-dashboard-project.ts";
import { WorkspaceDetail } from "./workspace-detail.tsx";

export function WorkspacePage({ projectSlug, workspaceId }: { projectSlug: string; workspaceId: string }) {
  const { project, projects } = useDashboardProject(projectSlug);

  if (projects.isPending) return <RouteLoading />;
  if (projects.isError) return <RouteError message="Could not load this project" onRetry={() => void projects.refetch()} />;
  if (!project) return <RouteNotFound resource="Project" />;

  return (
    <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
      <WorkspaceDetail project={project} workspaceId={workspaceId} />
    </div>
  );
}
