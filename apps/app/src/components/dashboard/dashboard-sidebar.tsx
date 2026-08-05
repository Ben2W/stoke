import { FolderKanban } from "lucide-react";

export function DashboardSidebar() {
  return (
    <aside className="shrink-0 border-b border-zinc-200 bg-zinc-50/60 p-3 md:w-60 md:border-b-0 md:border-r">
      <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="Dashboard navigation">
        <a className="flex h-10 shrink-0 items-center gap-3 rounded-md bg-zinc-200/70 px-3 text-sm font-medium text-zinc-950 md:w-full" href="/">
          <FolderKanban size={16} strokeWidth={1.8} />
          Projects
        </a>
      </nav>
    </aside>
  );
}
