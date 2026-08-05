import { ChevronsUpDown } from "lucide-react";
import { SignOutButton } from "../auth/auth-buttons.tsx";
import { StokeLogo } from "../brand/stoke-logo.tsx";

export function DashboardHeader({ user }: { user: { name: string; email: string; image?: string | null } }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <a className="flex items-center gap-2.5 text-sm font-semibold" href="/">
        <StokeLogo />
        <span>Stoke</span>
        <span className="hidden font-normal text-zinc-300 sm:inline">/</span>
        <span className="hidden max-w-40 truncate font-normal text-zinc-600 sm:inline">{user.name}</span>
        <ChevronsUpDown className="hidden text-zinc-400 sm:block" size={14} />
      </a>
      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-zinc-500 md:block">{user.email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
