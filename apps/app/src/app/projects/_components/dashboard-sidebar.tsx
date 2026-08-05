"use client";

import { FolderKanban, Terminal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { dashboardRoutes } from "../../../lib/routes.ts";
import { CliInstallCommand } from "../../../components/cli-install-command.tsx";

export function DashboardSidebar() {
  const pathname = usePathname();
  const projectsActive = pathname.startsWith(dashboardRoutes.projects);
  return (
    <aside className="shrink-0 border-b border-zinc-200 bg-zinc-50/60 p-3 md:flex md:w-60 md:flex-col md:border-b-0 md:border-r">
      <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="Dashboard navigation">
        <Link className={`flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium md:w-full ${projectsActive ? "bg-zinc-200/70 text-zinc-950" : "text-zinc-600 hover:bg-zinc-100"}`} href={dashboardRoutes.projects}>
          <FolderKanban size={16} strokeWidth={1.8} />
          Projects
        </Link>
      </nav>
      <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 md:mt-auto">
        <p className="flex items-center gap-2 text-xs font-medium text-zinc-900"><Terminal size={13} /> Install the CLI</p>
        <p className="mt-1.5 text-[10px] leading-4 text-zinc-500">Run Stoke from your terminal or coding agent.</p>
        <div className="mt-2.5"><CliInstallCommand compact /></div>
        <p className="mt-2 text-[10px] text-zinc-400">Requires <a className="underline underline-offset-2 hover:text-zinc-700" href="https://bun.sh">Bun</a>.</p>
      </div>
    </aside>
  );
}
