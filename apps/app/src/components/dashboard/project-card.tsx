import type { ManagedCheckout, ManagedProject, ManagedRun } from "@stoke/managed";
import { Check, ExternalLink, GitBranch, Laptop, MapPin } from "lucide-react";

type ProjectCardProps = {
  project: ManagedProject;
  checkouts: ManagedCheckout[];
  run?: ManagedRun;
  now: number;
};

export function ProjectCard({ project, checkouts, run, now }: ProjectCardProps) {
  const githubSource = project.source.kind === "github" ? project.source : undefined;
  const source = project.source.kind === "github"
    ? `${project.source.owner}/${project.source.repository}`
    : project.source.path;
  const sourceUrl = githubSource
    ? githubSource.url ?? `https://github.com/${source}`
    : undefined;

  return (
    <article className="group flex min-h-64 flex-col rounded-lg border border-zinc-200 bg-white p-5 shadow-xs transition hover:border-zinc-300 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-950 text-xs font-semibold uppercase text-white">
          {project.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-medium tracking-tight text-zinc-950">{project.name}</h3>
            <span className="grid size-5 shrink-0 place-items-center rounded-full border border-zinc-200 text-emerald-600"><Check size={11} strokeWidth={2.2} /></span>
          </div>
          {sourceUrl ? (
            <a className="mt-1 flex w-fit max-w-full items-center gap-1.5 truncate text-xs text-zinc-500 transition hover:text-zinc-950" href={sourceUrl} rel="noreferrer" target="_blank">
              <GitBranch size={12} /> <span className="truncate">{source}</span> <ExternalLink className="shrink-0" size={10} />
            </a>
          ) : (
            <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-zinc-500"><MapPin size={12} />{source}</span>
          )}
        </div>
      </div>

      <div className="mt-6 flex-1">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          <span>Checkouts</span>
          <span>{checkouts.length}</span>
        </div>
        <div className="mt-2 space-y-1.5">
          {checkouts.length ? checkouts.slice(0, 2).map((checkout) => (
            <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-2.5 py-2 text-xs" key={checkout.id}>
              <Laptop className="shrink-0 text-zinc-400" size={13} />
              <span className="min-w-0 flex-1 truncate text-zinc-700">{checkout.deviceName}</span>
              <span className="shrink-0 text-[10px] text-zinc-400">{relativeTime(checkout.lastSeenAt, now)}</span>
            </div>
          )) : (
            <p className="rounded-md border border-dashed border-zinc-200 px-2.5 py-3 text-xs text-zinc-400">No checkout linked yet</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
        <code className="truncate text-[11px] text-zinc-500">stoke use {project.slug}</code>
        {run?.status === "running" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-emerald-700">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Applying now
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-zinc-400">Updated {relativeTime(project.updatedAt, now)}</span>
        )}
      </div>
    </article>
  );
}

function relativeTime(value: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
