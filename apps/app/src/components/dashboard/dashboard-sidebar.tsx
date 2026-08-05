import { Braces, FolderKanban, KeyRound } from "lucide-react";

export type DashboardPage = "projects" | "environment-variables" | "api-keys";

const items = [
  { id: "projects" as const, icon: FolderKanban, label: "Projects" },
  { id: "environment-variables" as const, icon: Braces, label: "Environment Variables" },
  { id: "api-keys" as const, icon: KeyRound, label: "API Keys" },
];

export function DashboardSidebar({ activePage, onNavigate }: { activePage: DashboardPage; onNavigate(page: DashboardPage): void }) {
  return (
    <aside className="shrink-0 border-b border-zinc-200 bg-zinc-50/60 p-3 md:w-60 md:border-b-0 md:border-r">
      <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="Dashboard navigation">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            className={`flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm transition md:w-full ${activePage === id ? "bg-zinc-200/70 font-medium text-zinc-950" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"}`}
            key={id}
            onClick={() => onNavigate(id)}
            type="button"
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
