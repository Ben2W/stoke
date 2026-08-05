"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { currentUserQuery, runsQuery } from "../../../lib/queries.ts";
import { ActiveRunObservers } from "./active-run-observers.tsx";
import { DashboardHeader } from "./dashboard-header.tsx";
import { DashboardSidebar } from "./dashboard-sidebar.tsx";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useQuery(currentUserQuery);
  const runs = useQuery({ ...runsQuery, enabled: Boolean(user.data) });

  useEffect(() => {
    if (user.data === null) router.replace("/");
  }, [router, user.data]);

  if (user.isPending || user.data === null) return <DashboardLoading />;
  if (user.isError) return <DashboardError onRetry={() => void user.refetch()} />;

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <ActiveRunObservers runs={runs.data ?? []} />
      <DashboardHeader user={user.data} />
      <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
        <DashboardSidebar />
        <section className="min-w-0 flex-1 bg-zinc-50/40">{children}</section>
      </div>
    </main>
  );
}

function DashboardLoading() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="h-16 border-b border-zinc-200 bg-white" />
      <div className="mx-auto max-w-7xl animate-pulse space-y-5 px-5 py-8 sm:px-8">
        <div className="h-11 rounded-md bg-zinc-200/70" />
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((item) => <div className="h-64 rounded-lg bg-zinc-200/60" key={item} />)}
        </div>
      </div>
    </main>
  );
}

function DashboardError({ onRetry }: { onRetry(): void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-5 text-zinc-950">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-base font-medium">Could not load Stoke</h1>
        <p className="mt-2 text-sm text-zinc-500">The control plane did not respond.</p>
        <button className="mt-5 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" onClick={onRetry} type="button">Try again</button>
      </section>
    </main>
  );
}
