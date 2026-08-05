"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { dashboardRoutes } from "../../../../../lib/routes.ts";
import { RouteError, RouteLoading, RouteNotFound } from "../../../_components/route-status.tsx";
import { RunActivity } from "./run-activity.tsx";
import { useDashboardProject } from "../../../_components/use-dashboard-project.ts";

export function ProjectRunsPage({ projectSlug }: { projectSlug: string }) {
  const { project, projects } = useDashboardProject(projectSlug);

  if (projects.isPending) return <RouteLoading />;
  if (projects.isError) return <RouteError message="Could not load workflow runs" onRetry={() => void projects.refetch()} />;
  if (!project) return <RouteNotFound resource="Project" />;

  return (
    <>
      <div className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <Link className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-950" href={dashboardRoutes.project(project.slug)}><ArrowLeft size={13} /> {project.name}</Link>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Workflow runs</h1>
          <p className="mt-1.5 text-sm text-zinc-500">Live and recent executions for this project.</p>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        <RunActivity className="" project={project} />
      </div>
    </>
  );
}
