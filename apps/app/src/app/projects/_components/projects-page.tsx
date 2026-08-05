"use client";

import { useQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { checkoutsQuery, projectsQuery, runsQuery } from "../../../lib/queries.ts";
import { dashboardRoutes } from "../../../lib/routes.ts";
import { ProjectExplorer } from "./project-explorer.tsx";

export function ProjectsPage() {
  const router = useRouter();
  const [projects, checkouts, runs] = useQueries({
    queries: [projectsQuery, checkoutsQuery, runsQuery],
  });

  const error = projects.error ?? checkouts.error ?? runs.error;

  return (
    <>
      <div className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        {projects.isPending || checkouts.isPending || runs.isPending ? (
          <ProjectsLoading />
        ) : error ? (
          <ProjectsError onRetry={() => void Promise.all([projects.refetch(), checkouts.refetch(), runs.refetch()])} />
        ) : (
          <ProjectExplorer
            checkouts={checkouts.data ?? []}
            now={Date.now()}
            onProjectSelect={(project) => router.push(dashboardRoutes.project(project.slug))}
            projects={projects.data ?? []}
            runs={runs.data ?? []}
          />
        )}
      </div>
    </>
  );
}

function ProjectsLoading() {
  return <div className="grid animate-pulse gap-4 lg:grid-cols-2 2xl:grid-cols-3">{[0, 1, 2].map((item) => <div className="h-64 rounded-lg bg-zinc-200/60" key={item} />)}</div>;
}

function ProjectsError({ onRetry }: { onRetry(): void }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
      <p className="text-sm font-medium">Could not load your projects</p>
      <button className="mt-3 text-xs text-zinc-500 underline" onClick={onRetry} type="button">Try again</button>
    </div>
  );
}
