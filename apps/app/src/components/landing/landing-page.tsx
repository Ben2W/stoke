import { ArrowRight } from "lucide-react";
import { SignInButton } from "../auth/auth-buttons.tsx";
import { ProductPreview } from "./product-preview.tsx";
import { SiteHeader } from "./site-header.tsx";
import { WorkflowShowcase } from "./workflow-showcase.tsx";

export function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-zinc-200">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_60%_10%,rgba(0,0,0,0.045),transparent_34%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:py-36">
          <div className="max-w-xl">
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
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28" id="product">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">One workflow. Two ways to run it.</h2>
          <p className="mt-4 text-base leading-7 text-zinc-600">Plan, create, and operate the same development environments from the CLI or the dashboard. Both stay connected to the same project state.</p>
        </div>
        <WorkflowShowcase />
      </section>
    </main>
  );
}
