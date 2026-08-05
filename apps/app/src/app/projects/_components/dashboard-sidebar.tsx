"use client";

import { FolderKanban, Terminal, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { dashboardRoutes } from "../../../lib/routes.ts";
import { CliInstallCommand } from "../../../components/cli-install-command.tsx";

const CLI_CARD_DISMISSED_KEY = "stoke:dashboard-cli-card-dismissed";

export function DashboardSidebar() {
  const pathname = usePathname();
  const projectsActive = pathname.startsWith(dashboardRoutes.projects);
  const [cliCardDismissed, setCliCardDismissed] = useState(false);

  useEffect(() => {
    try {
      setCliCardDismissed(window.localStorage.getItem(CLI_CARD_DISMISSED_KEY) === "true");
    } catch {
      // The card remains visible when browser storage is unavailable.
    }
  }, []);

  const dismissCliCard = () => {
    setCliCardDismissed(true);
    try {
      window.localStorage.setItem(CLI_CARD_DISMISSED_KEY, "true");
    } catch {
      // Dismissing still works for this page view when storage is unavailable.
    }
  };

  return (
    <aside className="shrink-0 border-b border-zinc-200 bg-zinc-50/60 p-3 md:sticky md:top-16 md:flex md:h-[calc(100vh-4rem)] md:w-60 md:self-start md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
      <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="Dashboard navigation">
        <Link className={`flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium md:w-full ${projectsActive ? "bg-zinc-200/70 text-zinc-950" : "text-zinc-600 hover:bg-zinc-100"}`} href={dashboardRoutes.projects}>
          <FolderKanban size={16} strokeWidth={1.8} />
          Projects
        </Link>
      </nav>
      {!cliCardDismissed ? (
        <div className="relative mt-3 rounded-lg border border-zinc-200 bg-white p-3 md:mt-auto">
          <button aria-label="Dismiss CLI install tip" className="absolute right-2 top-2 grid size-6 place-items-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" onClick={dismissCliCard} type="button"><X size={13} /></button>
          <p className="flex items-center gap-2 pr-6 text-xs font-medium text-zinc-900"><Terminal size={13} /> Install the CLI</p>
          <p className="mt-1.5 text-[10px] leading-4 text-zinc-500">Run Stoke from your terminal or coding agent.</p>
          <div className="mt-2.5"><CliInstallCommand compact /></div>
          <p className="mt-2 text-[10px] text-zinc-400">Requires <a className="underline underline-offset-2 hover:text-zinc-700" href="https://bun.sh">Bun</a>.</p>
        </div>
      ) : null}
    </aside>
  );
}
