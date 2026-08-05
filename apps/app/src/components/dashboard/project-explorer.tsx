"use client";

import type { ManagedCheckout, ManagedProject, ManagedRun } from "@usestoke/managed";
import { Grid2X2, List, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectCard } from "./project-card.tsx";
import { AddProjectDialog } from "./add-project-dialog.tsx";

type ProjectExplorerProps = {
  projects: ManagedProject[];
  checkouts: ManagedCheckout[];
  runs: ManagedRun[];
  now: number;
  onProjectSelect(project: ManagedProject): void;
};

export function ProjectExplorer({ projects, checkouts, runs, now, onProjectSelect }: ProjectExplorerProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showAddProject, setShowAddProject] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => {
      const source = project.source.kind === "github"
        ? `${project.source.owner}/${project.source.repository}`
        : project.source.path;
      return `${project.name} ${project.slug} ${source}`.toLowerCase().includes(normalized);
    });
  }, [projects, query]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 shadow-xs focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-100">
          <Search className="shrink-0 text-zinc-400" size={17} strokeWidth={1.8} />
          <span className="sr-only">Search projects</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Projects"
            ref={searchRef}
            type="search"
            value={query}
          />
          <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-400 sm:block">/</kbd>
        </label>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-zinc-200 bg-white p-1 shadow-xs">
            <ViewButton active={view === "grid"} label="Grid view" onClick={() => setView("grid")}><Grid2X2 size={16} /></ViewButton>
            <ViewButton active={view === "list"} label="List view" onClick={() => setView("list")}><List size={17} /></ViewButton>
          </div>
          <button className="inline-flex h-11 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800" onClick={() => setShowAddProject(true)} type="button">
            <Plus size={16} />
            <span className="hidden sm:inline">Add Project</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyProjects />
      ) : filteredProjects.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-zinc-800">No projects match “{query}”</p>
          <button className="mt-2 text-sm text-zinc-500 underline underline-offset-4" onClick={() => setQuery("")} type="button">Clear search</button>
        </div>
      ) : (
        <div className={`mt-6 grid gap-4 ${view === "grid" ? "lg:grid-cols-2 2xl:grid-cols-3" : "grid-cols-1"}`}>
          {filteredProjects.map((project) => (
            <ProjectCard
              checkouts={checkouts.filter((checkout) => checkout.projectId === project.id)}
              key={project.id}
              now={now}
              onSelect={() => onProjectSelect(project)}
              project={project}
              run={runs.find((run) => run.projectId === project.id)}
            />
          ))}
        </div>
      )}
      <AddProjectDialog
        onClose={() => setShowAddProject(false)}
        onProjectAdded={onProjectSelect}
        open={showAddProject}
        projects={projects}
      />
    </>
  );
}

function ViewButton({ active, children, label, onClick }: { active: boolean; children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`grid size-8 place-items-center rounded ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-700"}`} aria-label={label} aria-pressed={active} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function EmptyProjects() {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
      <div className="mx-auto grid size-10 place-items-center rounded-full border border-zinc-200 bg-zinc-50"><Plus size={17} /></div>
      <h2 className="mt-4 text-sm font-medium text-zinc-950">Add your first project</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">Open a repository in your terminal and connect the current checkout.</p>
      <code className="mt-5 inline-block rounded-md bg-zinc-950 px-3 py-2 text-xs text-white">$ stoke add .</code>
    </div>
  );
}
