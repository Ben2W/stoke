"use client";

import type { ManagedCheckout, ManagedProject, ManagedWorkspace } from "@stoke/managed";
import { useQuery } from "@tanstack/react-query";
import { Box, Cloud, Laptop, MapPin } from "lucide-react";
import { projectWorkspacesQuery } from "../../lib/queries.ts";

export function ProjectWorkspaces({ project, checkouts }: { project: ManagedProject; checkouts: ManagedCheckout[] }) {
  const workspaces = useQuery(projectWorkspacesQuery(project.id));

  return (
    <section aria-labelledby="workspaces-heading">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-medium" id="workspaces-heading">Workspaces by machine</h2>
          <p className="mt-1 text-xs text-zinc-500">Workspace ownership follows the checkout that created it.</p>
        </div>
        <span className="text-xs tabular-nums text-zinc-400">{workspaces.data?.length ?? 0} workspaces</span>
      </div>

      {workspaces.isPending ? (
        <div className="h-36 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      ) : workspaces.isError ? (
        <button className="grid h-36 w-full place-items-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-500" onClick={() => void workspaces.refetch()} type="button">Could not load workspaces. Try again.</button>
      ) : (
        <WorkspaceMachines checkouts={checkouts} workspaces={workspaces.data} />
      )}
    </section>
  );
}

function WorkspaceMachines({ checkouts, workspaces }: { checkouts: ManagedCheckout[]; workspaces: ManagedWorkspace[] }) {
  const groups = new Map<string, { checkout?: ManagedCheckout; workspaces: ManagedWorkspace[] }>();
  for (const checkout of checkouts) groups.set(checkout.id, { checkout, workspaces: [] });
  for (const workspace of workspaces) {
    const deviceCheckout = workspace.deviceId
      ? checkouts.find((checkout) => checkout.deviceId === workspace.deviceId)
      : undefined;
    const key = workspace.checkoutId ?? deviceCheckout?.id ?? (workspace.deviceId ? `device:${workspace.deviceId}` : "unassigned");
    const group = groups.get(key) ?? {
      checkout: deviceCheckout,
      workspaces: [],
    };
    group.workspaces.push(workspace);
    groups.set(key, group);
  }

  if (!groups.size) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
        <Box className="mx-auto text-zinc-300" size={21} />
        <p className="mt-3 text-sm font-medium text-zinc-800">No machines or workspaces yet</p>
        <p className="mt-1 text-xs text-zinc-500">Link a checkout with <code className="rounded bg-zinc-100 px-1 py-0.5">stoke add /path/to/project</code>.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[...groups.entries()].map(([key, group]) => {
        const cloud = group.checkout?.path.startsWith("vercel-sandbox://");
        const deviceName = group.checkout?.deviceName ?? group.workspaces[0]?.deviceName ?? "Unassigned";
        return (
          <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs" key={key}>
            <div className="flex items-start gap-3 border-b border-zinc-100 px-4 py-3.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500">{cloud ? <Cloud size={15} /> : <Laptop size={15} />}</div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium">{deviceName}</h3>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-zinc-400"><MapPin size={10} /> {group.checkout?.path ?? "No checkout information"}</p>
              </div>
              <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] tabular-nums text-zinc-500">{group.workspaces.length}</span>
            </div>
            {group.workspaces.length ? (
              <ul className="divide-y divide-zinc-100">
                {group.workspaces.map((workspace) => (
                  <li className="flex items-center gap-3 px-4 py-3" key={workspace.id}>
                    <Box className="shrink-0 text-zinc-400" size={14} />
                    <span className="min-w-0 flex-1"><strong className="block truncate text-xs font-medium">{workspace.name}</strong><span className="mt-0.5 block truncate text-[11px] text-zinc-400">{workspace.workflow}</span></span>
                    <time className="text-[10px] text-zinc-400">{relativeTime(workspace.updatedAt)}</time>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-center text-xs text-zinc-400">No workspaces on this machine</p>}
          </article>
        );
      })}
    </div>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}
