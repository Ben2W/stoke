"use client";

import Link from "next/link";
import { dashboardRoutes } from "../../../lib/routes.ts";

export function RouteLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse space-y-4 px-5 py-8 sm:px-8">
      <div className="h-4 w-24 rounded bg-zinc-200" />
      <div className="h-44 rounded-xl border border-zinc-200 bg-white" />
      <div className="h-32 rounded-xl border border-zinc-200 bg-white" />
    </div>
  );
}

export function RouteError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm font-medium">{message}</p>
        <button className="mt-3 text-xs text-zinc-500 underline" onClick={onRetry} type="button">Try again</button>
      </div>
    </div>
  );
}

export function RouteNotFound({ resource }: { resource: "Project" | "Workspace" }) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm font-medium">{resource} not found</p>
        <Link className="mt-3 inline-block text-xs text-zinc-500 underline" href={dashboardRoutes.projects}>Back to projects</Link>
      </div>
    </div>
  );
}
