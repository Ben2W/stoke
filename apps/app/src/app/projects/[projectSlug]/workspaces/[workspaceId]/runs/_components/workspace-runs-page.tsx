"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { projectWorkspacesQuery } from "../../../../../../../lib/queries.ts";
import { dashboardRoutes } from "../../../../../../../lib/routes.ts";
import { RouteError, RouteLoading, RouteNotFound } from "../../../../../_components/route-status.tsx";
import { useDashboardProject } from "../../../../../_components/use-dashboard-project.ts";
import { WorkspaceRunHistory } from "./workspace-run-history.tsx";

export function WorkspaceRunsPage({ projectSlug, workspaceId }: { projectSlug: string; workspaceId: string }) {
  const { project, projects } = useDashboardProject(projectSlug);
  const workspaces = useQuery(projectWorkspacesQuery(project?.id));

  if (projects.isPending || (project && workspaces.isPending)) return <RouteLoading />;
  if (projects.isError) return <RouteError message="Could not load this project" onRetry={() => void projects.refetch()} />;
  if (!project) return <RouteNotFound resource="Project" />;
  if (workspaces.isError) return <RouteError message="Could not load workspace runs" onRetry={() => void workspaces.refetch()} />;
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  if (!workspace) return <RouteNotFound resource="Workspace" />;

  return (
    <>
      <div className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <Link className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-950" href={dashboardRoutes.workspace(project.slug, workspace.id)}><ArrowLeft size={13} /> {workspace.name}</Link>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Workspace runs</h1>
          <p className="mt-1.5 text-sm text-zinc-500">Console output and failure logs for {workspace.name}.</p>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        <WorkspaceRunHistory className="" projectId={project.id} workspace={workspace} />
      </div>
    </>
  );
}
