"use client";

import type { ManagedCheckout, ManagedProject } from "@usestoke/managed";
import { ArrowLeft, ExternalLink, GitBranch } from "lucide-react";
import { ProjectCache } from "./project-cache.tsx";
import { ProjectCheckouts } from "./project-checkouts.tsx";
import { ProjectDangerZone } from "./project-danger-zone.tsx";
import { ProjectWorkspaces } from "./project-workspaces.tsx";
import { WorkspaceDetail } from "./workspace-detail.tsx";
import { RunActivity } from "./run-activity.tsx";

export function ProjectDetail({
  project,
  checkouts,
  onBack,
  selectedWorkspaceId,
  onWorkspaceSelect,
  onWorkspaceBack,
}: {
  project: ManagedProject;
  checkouts: ManagedCheckout[];
  onBack(): void;
  selectedWorkspaceId?: string;
  onWorkspaceSelect(workspaceId: string): void;
  onWorkspaceBack(): void;
}) {
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
          <button className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-950" onClick={onBack} type="button"><ArrowLeft size={13} /> All Projects</button>
          <div className="mt-4">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            {sourceUrl ? (
              <a className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-950" href={sourceUrl} rel="noreferrer" target="_blank"><GitBranch size={14} /> {source} <ExternalLink size={11} /></a>
            ) : <p className="mt-1.5 text-sm text-zinc-500">{source}</p>}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        {selectedWorkspaceId ? (
          <WorkspaceDetail onBack={onWorkspaceBack} project={project} workspaceId={selectedWorkspaceId} />
        ) : (
          <>
            <ProjectWorkspaces onSelect={onWorkspaceSelect} project={project} />
            <ProjectCheckouts checkouts={checkouts} />
            <ProjectCache project={project} />
            <RunActivity project={project} />
            <ProjectDangerZone onDeleted={onBack} project={project} />
          </>
        )}
      </div>
    </>
  );
}
