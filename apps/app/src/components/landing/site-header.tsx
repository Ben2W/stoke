import { StokeLogo } from "../brand/stoke-logo.tsx";
import { SignInButton } from "../auth/auth-buttons.tsx";

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <a className="flex items-center gap-2.5 text-sm font-semibold tracking-tight" href="/">
          <StokeLogo />
          Stoke
        </a>
        <nav className="flex items-center gap-5 text-sm text-zinc-500" aria-label="Primary navigation">
          <a className="hidden transition hover:text-zinc-950 sm:block" href="#product">Product</a>
          <a className="hidden transition hover:text-zinc-950 sm:block" href="https://github.com/Ben2W/stoke">GitHub</a>
          <SignInButton compact />
        </nav>
      </div>
    </header>
  );
}
