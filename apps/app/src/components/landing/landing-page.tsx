import { ArrowRight, Box, Cloud, GitBranch, Terminal } from "lucide-react";
import { SignInButton } from "../auth/auth-buttons.tsx";
import { ProductPreview } from "./product-preview.tsx";
import { SiteHeader } from "./site-header.tsx";

const capabilities = [
  {
    icon: GitBranch,
    title: "One project identity",
    copy: "Add a GitHub repository once, then connect every local checkout and remote environment to it.",
  },
  {
    icon: Terminal,
    title: "Local TypeScript workflows",
    copy: "Keep Rigkit’s typed workflow engine on the machine doing the work, including cmux integration.",
  },
  {
    icon: Cloud,
    title: "Vercel-native execution",
    copy: "Carry the same project state into Vercel Sandbox, CI, and shared caches when work moves remote.",
  },
];

export function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-zinc-200">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_60%_10%,rgba(0,0,0,0.045),transparent_34%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:py-36">
          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Built exclusively for Vercel
            </div>
            <h1 className="text-balance text-5xl font-semibold tracking-[-0.055em] sm:text-6xl lg:text-[4.6rem] lg:leading-[0.98]">
              Your project, wherever the work runs.
            </h1>
            <p className="mt-7 max-w-lg text-pretty text-lg leading-8 text-zinc-600">
              Stoke gives repositories a managed identity shared by local checkouts,
              coding agents, CI, and Vercel Sandboxes.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <SignInButton />
              <a className="inline-flex h-11 items-center gap-2 px-1 text-sm font-medium text-zinc-600 transition hover:text-zinc-950" href="#product">
                See how it works <ArrowRight size={15} />
              </a>
            </div>
            <div className="mt-10 flex items-center gap-3 font-mono text-xs text-zinc-500">
              <span className="text-zinc-400">$</span>
              <span>stoke add .</span>
              <span className="text-zinc-300">→</span>
              <span className="text-zinc-950">linked</span>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28" id="product">
        <div className="mb-12 max-w-2xl">
          <p className="text-sm font-medium text-zinc-500">The managed layer Rigkit was missing</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Stable projects. Replaceable environments.</h2>
          <p className="mt-4 text-base leading-7 text-zinc-600">A checkout is a location, not the identity. Stoke keeps the project stable while laptops, paths, runners, and sandboxes change.</p>
        </div>
        <div className="grid overflow-hidden rounded-xl border border-zinc-200 md:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, copy }, index) => (
            <article className={`p-7 ${index ? "border-t border-zinc-200 md:border-l md:border-t-0" : ""}`} key={title}>
              <div className="grid size-9 place-items-center rounded-md border border-zinc-200 bg-zinc-50"><Icon size={17} strokeWidth={1.7} /></div>
              <h3 className="mt-12 text-base font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-zinc-50/70">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center">
          <div>
            <Box className="text-zinc-400" size={24} strokeWidth={1.5} />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">Local today. Sandbox next.</h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-zinc-600">The CLI still evaluates your TypeScript locally. The control plane coordinates identity, checkout state, and eventually cache artifacts—without putting latency in the local loop.</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-950 p-5 font-mono text-xs leading-7 text-zinc-400 shadow-lg">
            <p><span className="text-zinc-600">$</span> <span className="text-white">stoke use stoke</span></p>
            <p><span className="text-emerald-400">✓</span> project context restored</p>
            <p><span className="text-zinc-600">$</span> <span className="text-white">stoke run dev</span></p>
            <p className="text-zinc-500">workflow evaluated locally · cache ready</p>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-zinc-950" /> Stoke</span>
        <span>Managed development environments on Vercel.</span>
        <span>Private preview · 2026</span>
      </footer>
    </main>
  );
}
