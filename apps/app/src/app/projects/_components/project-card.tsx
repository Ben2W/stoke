"use client";

import type { ManagedCheckout, ManagedProject, ManagedRun } from "@usestoke/managed";
import { ArrowUpRight, Check, GitBranch, Laptop, MapPin } from "lucide-react";
import { shortFingerprint } from "../../../lib/fingerprint.ts";

type ProjectCardProps = {
  project: ManagedProject;
  checkouts: ManagedCheckout[];
  run?: ManagedRun;
  now: number;
  onSelect(): void;
};

export function ProjectCard({ project, checkouts, run, now, onSelect }: ProjectCardProps) {
  const source = project.source.kind === "github"
    ? `${project.source.owner}/${project.source.repository}`
    : project.source.path;

  return (
    <button className="group flex min-h-64 flex-col rounded-lg border border-zinc-200 bg-white p-5 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2" onClick={onSelect} type="button">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-950 text-xs font-semibold uppercase text-white">
          {project.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-medium tracking-tight text-zinc-950">{project.name}</h3>
            <span className="grid size-5 shrink-0 place-items-center rounded-full border border-zinc-200 text-emerald-600"><Check size={11} strokeWidth={2.2} /></span>
            <ArrowUpRight className="ml-auto shrink-0 text-zinc-300 transition group-hover:text-zinc-700" size={15} />
          </div>
          {project.source.kind === "github" ? (
            <span className="mt-1 flex max-w-full items-center gap-1.5 truncate text-xs text-zinc-500">
              <GitBranch size={12} /> <span className="truncate">{source}</span>
            </span>
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
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            {runLabel(run.operation)} <code className="font-mono" title={run.fingerprint}>{shortFingerprint(run.fingerprint)}</code>
          </span>
        ) : run ? (
          <code className="shrink-0 font-mono text-[10px] text-zinc-400" title={run.fingerprint}>{shortFingerprint(run.fingerprint)}</code>
        ) : (
          <span className="shrink-0 text-[10px] text-zinc-400">Updated {relativeTime(project.updatedAt, now)}</span>
        )}
      </div>
    </button>
  );
}

function runLabel(operation: ManagedRun["operation"]): string {
  if (operation === "apply") return "Applying";
  if (operation === "plan") return "Planning";
  if (operation === "create") return "Creating workspace";
  if (operation === "remove") return "Removing workspace";
  return "Running operation";
}

function relativeTime(value: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
