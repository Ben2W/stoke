"use client";

import type { ManagedCheckout, ManagedProject, ManagedRun } from "@usestoke/managed";
import { Braces, Construction, KeyRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "./dashboard-header.tsx";
import { DashboardSidebar, type DashboardPage } from "./dashboard-sidebar.tsx";
import { ProjectExplorer } from "./project-explorer.tsx";
import { ProjectDetail } from "./project-detail.tsx";

type ProjectDashboardProps = {
  user: { name: string; email: string; image?: string | null };
  projects: ManagedProject[];
  checkouts: ManagedCheckout[];
  runs: ManagedRun[];
};

export function ProjectDashboard({ user, projects, checkouts, runs }: ProjectDashboardProps) {
  const [activePage, setActivePage] = useState<DashboardPage>("projects");
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId || project.slug === selectedProjectId),
    [projects, selectedProjectId],
  );
  useEffect(() => {
    const selectFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const page = params.get("view");
      setActivePage(page === "environment-variables" || page === "api-keys" ? page : "projects");
      setSelectedProjectId(params.get("project") ?? undefined);
      setSelectedWorkspaceId(params.get("workspace") ?? undefined);
    };
    selectFromUrl();
    window.addEventListener("popstate", selectFromUrl);
    return () => window.removeEventListener("popstate", selectFromUrl);
  }, []);

  const selectProject = (project: ManagedProject) => {
    window.history.pushState(null, "", `/?project=${encodeURIComponent(project.slug)}`);
    setActivePage("projects");
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
    setActivePage("projects");
    setSelectedProjectId(undefined);
    setSelectedWorkspaceId(undefined);
  };
  const navigate = (page: DashboardPage) => {
    window.history.pushState(null, "", page === "projects" ? "/" : `/?view=${page}`);
    setActivePage(page);
    setSelectedProjectId(undefined);
    setSelectedWorkspaceId(undefined);
  };

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <DashboardHeader user={user} />
      <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
        <DashboardSidebar activePage={activePage} onNavigate={navigate} />
        <section className="min-w-0 flex-1 bg-zinc-50/40">
          {activePage === "environment-variables" ? (
            <UnderConstructionPage description="Manage shared configuration for your Stoke projects." icon={Braces} title="Environment Variables" />
          ) : activePage === "api-keys" ? (
            <UnderConstructionPage description="Create and revoke credentials for Stoke automation." icon={KeyRound} title="API Keys" />
          ) : selectedProject ? (
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

function UnderConstructionPage({ description, icon: Icon, title }: { description: string; icon: typeof Braces; title: string }) {
  return (
    <div>
      <div className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="flex max-w-xl items-start gap-4 rounded-lg border border-zinc-200 bg-white p-6">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Icon size={18} strokeWidth={1.8} /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Under construction</h2>
              <Construction className="text-zinc-400" size={14} />
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
