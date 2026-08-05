"use client";

import type { ManagedCheckout, ManagedProject } from "@usestoke/managed";
import { Activity, ArrowLeft, ExternalLink, GitBranch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashboardRoutes } from "../../../../lib/routes.ts";
import { ProjectCache } from "./project-cache.tsx";
import { ProjectCheckouts } from "./project-checkouts.tsx";
import { ProjectDangerZone } from "./project-danger-zone.tsx";
import { ProjectWorkspaces } from "./project-workspaces.tsx";

export function ProjectDetail({
  project,
  checkouts,
}: {
  project: ManagedProject;
  checkouts: ManagedCheckout[];
}) {
  const router = useRouter();
  const source = project.source.kind === "github"
    ? `${project.source.owner}/${project.source.repository}`
    : project.source.path;
  const sourceUrl = project.source.kind === "github"
    ? project.source.url ?? `https://github.com/${source}`
    : undefined;

  return (
    <>
      <div className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <Link className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-950" href={dashboardRoutes.projects}><ArrowLeft size={13} /> All Projects</Link>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              {sourceUrl ? (
                <a className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-950" href={sourceUrl} rel="noreferrer" target="_blank"><GitBranch size={14} /> {source} <ExternalLink size={11} /></a>
              ) : <p className="mt-1.5 text-sm text-zinc-500">{source}</p>}
            </div>
            <Link className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-xs transition hover:border-zinc-300 hover:bg-zinc-50" href={dashboardRoutes.projectRuns(project.slug)}><Activity size={14} /> View runs</Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        <ProjectWorkspaces onSelect={(workspaceId) => router.push(dashboardRoutes.workspace(project.slug, workspaceId))} project={project} />
        <ProjectCache project={project} />
        <ProjectCheckouts checkouts={checkouts} />
        <ProjectDangerZone onDeleted={() => router.push(dashboardRoutes.projects)} project={project} />
      </div>
    </>
  );
}
