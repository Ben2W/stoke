"use client";

import type { ManagedCheckout, ManagedProject, ManagedRun } from "@usestoke/managed";
import { Activity, Box, FolderKanban, Laptop } from "lucide-react";
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
  const deviceCount = new Set(checkouts.map((checkout) => checkout.deviceId)).size;
  const activeRunCount = runs.filter((run) => run.status === "running").length;

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
      <div className="flex min-h-[calc(100vh-4rem)]">
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
                    <p className="text-xs text-zinc-500">Overview</p>
                    <h1 className="mt-1 text-xl font-semibold tracking-tight">All Projects</h1>
                  </div>
                  <span className="hidden text-xs text-zinc-400 sm:block">Managed by Stoke</span>
                </div>
              </div>

              <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
                <ProjectExplorer checkouts={checkouts} now={Date.now()} onProjectSelect={selectProject} projects={projects} runs={runs} />

                <section className="mt-8" aria-labelledby="usage-heading">
                  <h2 className="mb-3 text-sm font-medium" id="usage-heading">Workspace</h2>
                  <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
                    <Metric icon={FolderKanban} label="Projects" value={projects.length} />
                    <Metric border icon={Laptop} label="Devices" value={deviceCount} />
                    <Metric border icon={Box} label="Checkouts" value={checkouts.length} />
                    <Metric border icon={Activity} label="Active runs" value={activeRunCount} />
                  </div>
                </section>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ border = false, icon: Icon, label, value }: { border?: boolean; icon: typeof Box; label: string; value: number }) {
  return (
    <div className={`flex items-center gap-3 p-5 ${border ? "border-t border-zinc-200 sm:border-l sm:border-t-0" : ""}`}>
      <div className="grid size-9 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Icon size={16} strokeWidth={1.8} /></div>
      <div><strong className="block text-lg font-semibold tabular-nums">{value}</strong><span className="text-xs text-zinc-500">{label}</span></div>
    </div>
  );
}
