"use client";

import type { ManagedUser } from "@usestoke/managed";
import { useQueries } from "@tanstack/react-query";
import { checkoutsQuery, projectsQuery, runsQuery } from "../../lib/queries.ts";
import { ActiveRunObservers } from "./active-run-observers.tsx";
import { ProjectDashboard } from "./project-dashboard.tsx";

export function DashboardScreen({ user }: { user: ManagedUser }) {
  const [projects, checkouts, runs] = useQueries({
    queries: [projectsQuery, checkoutsQuery, runsQuery],
  });

  if (projects.isPending || checkouts.isPending || runs.isPending) {
    return <DashboardLoading user={user} />;
  }

  const error = projects.error ?? checkouts.error ?? runs.error;
  if (error) {
    return (
      <DashboardError
        onRetry={() => void Promise.all([projects.refetch(), checkouts.refetch(), runs.refetch()])}
        user={user}
      />
    );
  }

  return (
    <>
      <ActiveRunObservers runs={runs.data ?? []} />
      <ProjectDashboard
        checkouts={checkouts.data ?? []}
        projects={projects.data ?? []}
        runs={runs.data ?? []}
        user={user}
      />
    </>
  );
}

function DashboardLoading({ user }: { user: ManagedUser }) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="flex h-16 items-center border-b border-zinc-200 bg-white px-6 text-sm font-medium">Stoke / {user.name}</div>
      <div className="mx-auto max-w-7xl animate-pulse space-y-5 px-5 py-8 sm:px-8">
        <div className="h-11 rounded-md bg-zinc-200/70" />
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((item) => <div className="h-64 rounded-lg bg-zinc-200/60" key={item} />)}
        </div>
      </div>
    </main>
  );
}

function DashboardError({ onRetry, user }: { onRetry(): void; user: ManagedUser }) {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-5 text-zinc-950">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs text-zinc-400">Signed in as {user.email}</p>
        <h1 className="mt-2 text-base font-medium">Could not load your projects</h1>
        <button className="mt-5 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" onClick={onRetry} type="button">Try again</button>
      </section>
    </main>
  );
}
