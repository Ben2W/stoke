"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LandingPage } from "../components/landing/landing-page.tsx";
import { currentUserQuery } from "../lib/queries.ts";
import { dashboardRoutes } from "../lib/routes.ts";

export default function Home() {
  const router = useRouter();
  const user = useQuery(currentUserQuery);

  useEffect(() => {
    if (!user.data) return;
    const search = new URLSearchParams(window.location.search);
    const project = search.get("project");
    const workspace = search.get("workspace");
    const destination = project
      ? workspace
        ? dashboardRoutes.workspace(project, workspace)
        : dashboardRoutes.project(project)
      : dashboardRoutes.projects;
    router.replace(destination);
  }, [router, user.data]);

  if (user.isPending || user.data) return <AppLoading />;
  if (user.isError) return <AppError onRetry={() => void user.refetch()} />;
  return <LandingPage />;
}

function AppLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-white text-zinc-950">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="size-2 animate-pulse rounded-full bg-zinc-950" />
        Loading Stoke
      </div>
    </main>
  );
}

function AppError({ onRetry }: { onRetry(): void }) {
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
