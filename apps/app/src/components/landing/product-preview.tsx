import { Check, GitBranch, Laptop, MoreHorizontal } from "lucide-react";

const projects = [
  { name: "stoke", repo: "ben2w/stoke", initial: "S", checkouts: "2 checkouts" },
  { name: "acme-web", repo: "acme/web", initial: "A", checkouts: "4 checkouts" },
];

export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_70px_-32px_rgba(0,0,0,0.28)]">
      <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-700">
          <span className="size-2 rounded-full bg-emerald-500" />
          All Projects
        </div>
        <MoreHorizontal className="text-zinc-400" size={17} />
      </div>
      <div className="bg-zinc-50/70 p-4 sm:p-5">
        <div className="mb-4 rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-xs text-zinc-400">
          Search projects…
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs" key={project.name}>
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-950 text-xs font-semibold text-white">{project.initial}</div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-zinc-950">{project.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-500"><GitBranch size={12} />{project.repo}</p>
                </div>
                <span className="grid size-6 place-items-center rounded-full border border-zinc-200 text-emerald-600"><Check size={13} /></span>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5"><Laptop size={12} />{project.checkouts}</span>
                <span>Active now</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
