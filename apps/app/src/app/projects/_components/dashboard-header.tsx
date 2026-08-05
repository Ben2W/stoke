"use client";

import Link from "next/link";
import { dashboardRoutes } from "../../../lib/routes.ts";
import { SignOutButton } from "../../../components/auth/auth-buttons.tsx";
import { StokeLogo } from "../../../components/brand/stoke-logo.tsx";

export function DashboardHeader({ user }: { user: { name: string; email: string; image?: string | null } }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <Link className="flex items-center gap-2.5 text-sm font-semibold" href={dashboardRoutes.projects}>
        <StokeLogo />
        <span>Stoke</span>
        <span className="hidden font-normal text-zinc-300 sm:inline">/</span>
        <span className="hidden max-w-40 truncate font-normal text-zinc-600 sm:inline">{user.name}</span>
      </Link>
      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-zinc-500 md:block">{user.email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
