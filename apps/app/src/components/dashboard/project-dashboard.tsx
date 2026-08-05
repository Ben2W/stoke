"use client";

import type { ManagedCheckout, ManagedProject, ManagedRun } from "@usestoke/managed";
import { useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "./dashboard-header.tsx";
import { DashboardSidebar } from "./dashboard-sidebar.tsx";
import { ProjectExplorer } from "./project-explorer.tsx";
import { ProjectDetail } from "./project-detail.tsx";

type ProjectDashboardProps = {
  user: { name: string; email: string; image?: string | null };
  projects: ManagedProject[];
  checkouts: ManagedCheckout[];
  runs: ManagedRun[];
};

export function ProjectDashboard({ user, projects, checkouts, runs }: ProjectDashboardProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId || project.slug === selectedProjectId),
    [projects, selectedProjectId],
  );
  useEffect(() => {
    const selectFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedProjectId(params.get("project") ?? undefined);
      setSelectedWorkspaceId(params.get("workspace") ?? undefined);
    };
    selectFromUrl();
    window.addEventListener("popstate", selectFromUrl);
    return () => window.removeEventListener("popstate", selectFromUrl);
  }, []);
  useEffect(() => {
    document.title = selectedProject ? `Stoke - ${selectedProject.name}` : "Stoke";
  }, [selectedProject]);

  const selectProject = (project: ManagedProject) => {
    window.history.pushState(null, "", `/?project=${encodeURIComponent(project.slug)}`);
    setSelectedProjectId(project.id);
    setSelectedWorkspaceId(undefined);
  };
  const selectWorkspace = (workspaceId: string) => {
    if (!selectedProject) return;
    window.history.pushState(null, "", `/?project=${encodeURIComponent(selectedProject.slug)}&workspace=${encodeURIComponent(workspaceId)}`);
    setSelectedWorkspaceId(workspaceId);
  };
  const showProject = () => {
    if (!selectedProject) return;
    window.history.pushState(null, "", `/?project=${encodeURIComponent(selectedProject.slug)}`);
    setSelectedWorkspaceId(undefined);
  };
  const showProjects = () => {
    window.history.pushState(null, "", "/");
    setSelectedProjectId(undefined);
    setSelectedWorkspaceId(undefined);
  };

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <DashboardHeader user={user} />
      <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
        <DashboardSidebar />
        <section className="min-w-0 flex-1 bg-zinc-50/40">
          {selectedProject ? (
            <ProjectDetail
              checkouts={checkouts.filter((checkout) => checkout.projectId === selectedProject.id)}
              onBack={showProjects}
              onWorkspaceBack={showProject}
              onWorkspaceSelect={selectWorkspace}
              project={selectedProject}
              selectedWorkspaceId={selectedWorkspaceId}
            />
          ) : (
            <>
              <div className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
                <div className="mx-auto flex max-w-7xl items-center justify-between">
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
                  </div>
                </div>
              </div>

              <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
                <ProjectExplorer checkouts={checkouts} now={Date.now()} onProjectSelect={selectProject} projects={projects} runs={runs} />
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
