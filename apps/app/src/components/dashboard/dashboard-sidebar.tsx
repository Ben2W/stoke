import { CircleGauge, FolderKanban, Settings2 } from "lucide-react";

export function DashboardSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-zinc-50/60 p-3 md:flex md:flex-col">
      <nav className="space-y-1" aria-label="Dashboard navigation">
        <span className="flex h-10 items-center gap-3 rounded-md bg-zinc-200/70 px-3 text-sm font-medium text-zinc-950">
          <FolderKanban size={16} strokeWidth={1.8} />
          Projects
        </span>
      </nav>
      <div className="mt-5 border-t border-zinc-200 pt-4">
        <p className="px-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Execution</p>
        <div className="mt-2 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-zinc-500">
          <CircleGauge size={16} strokeWidth={1.8} />
          Sandboxes
          <span className="ml-auto rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px]">Soon</span>
        </div>
      </div>
      <span aria-disabled="true" className="mt-auto flex h-10 items-center gap-3 rounded-md px-3 text-sm text-zinc-400">
        <Settings2 size={16} strokeWidth={1.8} />
        Settings
      </span>
    </aside>
  );
}
