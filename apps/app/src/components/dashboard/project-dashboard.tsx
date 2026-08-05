import type { ManagedCheckout, ManagedProject } from "@stoke/managed";
import { Box, FolderKanban, Laptop } from "lucide-react";
import { DashboardHeader } from "./dashboard-header.tsx";
import { DashboardSidebar } from "./dashboard-sidebar.tsx";
import { ProjectExplorer } from "./project-explorer.tsx";

export function ProjectDashboard({ user, projects, checkouts }: { user: { name: string; email: string; image?: string | null }; projects: ManagedProject[]; checkouts: ManagedCheckout[] }) {
  const deviceCount = new Set(checkouts.map((checkout) => checkout.deviceId)).size;

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <DashboardHeader user={user} />
      <div className="flex min-h-[calc(100vh-4rem)]">
        <DashboardSidebar />
        <section className="min-w-0 flex-1 bg-zinc-50/40">
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
            <ProjectExplorer checkouts={checkouts} now={Date.now()} projects={projects} />

            <section className="mt-8" aria-labelledby="usage-heading">
              <h2 className="mb-3 text-sm font-medium" id="usage-heading">Workspace</h2>
              <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white sm:grid-cols-3">
                <Metric icon={FolderKanban} label="Projects" value={projects.length} />
                <Metric border icon={Laptop} label="Devices" value={deviceCount} />
                <Metric border icon={Box} label="Checkouts" value={checkouts.length} />
              </div>
            </section>
          </div>
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
