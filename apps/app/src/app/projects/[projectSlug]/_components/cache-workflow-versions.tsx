"use client";

import { Check, ChevronDown, GitBranch, Laptop, Monitor } from "lucide-react";
import Link from "next/link";
import { shortFingerprint } from "../../../../lib/fingerprint.ts";
import { dashboardRoutes } from "../../../../lib/routes.ts";
import {
  cacheOwnershipOriginLabel,
  cacheOwnershipSourceLabel,
  type CacheOwnershipGroup,
} from "./cache-ownership.ts";

export function CacheWorkflowVersions({
  expandedKey,
  groups,
  highlightedKey,
  onExpandedChange,
  onHighlightedChange,
  projectSlug,
}: {
  expandedKey?: string;
  groups: CacheOwnershipGroup[];
  highlightedKey?: string;
  onExpandedChange(key: string | undefined): void;
  onHighlightedChange(key: string | undefined): void;
  projectSlug: string;
}) {
  return (
    <aside className="w-full shrink-0 border-b border-zinc-200 bg-white p-3 lg:w-60 lg:border-b-0 lg:border-r" aria-label="Workflow versions">
      <div className="px-1 pb-2">
        <h3 className="text-[11px] font-medium text-zinc-800">Workflow versions</h3>
        <p className="mt-0.5 text-[10px] leading-4 text-zinc-500">Hover a fingerprint to trace the nodes it uses.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
        {groups.map((group) => {
          const expanded = expandedKey === group.key;
          const highlighted = highlightedKey === group.key;
          const origin = cacheOwnershipOriginLabel(group);
          const source = cacheOwnershipSourceLabel(group);
          return (
            <div
              className={`min-w-52 overflow-hidden rounded-lg border bg-white transition lg:min-w-0 ${highlighted ? group.main ? "border-blue-300 shadow-sm ring-2 ring-blue-100" : "border-violet-300 shadow-sm ring-2 ring-violet-100" : "border-zinc-200"}`}
              key={group.key}
              onMouseEnter={() => onHighlightedChange(group.key)}
              onMouseLeave={() => onHighlightedChange(undefined)}
            >
              <button
                aria-expanded={group.workspaces.length ? expanded : undefined}
                className="w-full p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                onBlur={() => onHighlightedChange(undefined)}
                onClick={() => group.workspaces.length && onExpandedChange(expanded ? undefined : group.key)}
                onFocus={() => onHighlightedChange(group.key)}
                type="button"
              >
                <span className="flex items-center justify-between gap-2">
                  <code className={`font-mono text-xs font-semibold ${group.main ? "text-blue-700" : "text-violet-700"}`} title={group.fingerprint}>
                    {shortFingerprint(group.fingerprint)}
                  </code>
                  {group.workspaces.length ? <ChevronDown className={`shrink-0 text-zinc-400 transition ${expanded ? "rotate-180" : ""}`} size={12} /> : <Check className="shrink-0 text-zinc-300" size={12} />}
                </span>
                <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium text-zinc-700">
                  <GitBranch size={11} /> {origin}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[9px] text-zinc-400">
                  <span className="inline-flex min-w-0 items-center gap-1 truncate">
                    {source === "Remote repository" || source === "Dashboard" ? <Monitor size={10} /> : <Laptop size={10} />}
                    <span className="truncate">{source}</span>
                  </span>
                  <span className="shrink-0">{workspaceCountLabel(group.workspaces.length)}</span>
                </span>
              </button>
              {expanded ? (
                <div className="border-t border-zinc-100 p-1.5">
                  {group.workspaces.map((workspace) => (
                    <Link
                      className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-zinc-50"
                      href={dashboardRoutes.workspace(projectSlug, workspace.id)}
                      key={workspace.id}
                    >
                      <span className="truncate font-medium text-zinc-700">{workspace.name}</span>
                      <code className="shrink-0 font-mono text-zinc-400">{workspace.revision?.slice(0, 7) ?? "unversioned"}</code>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function workspaceCountLabel(count: number): string {
  return `${count} ${count === 1 ? "workspace" : "workspaces"}`;
}
