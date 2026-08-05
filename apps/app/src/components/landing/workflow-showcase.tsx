import { Check, CircleDot, LayoutDashboard, Terminal } from "lucide-react";

export function WorkflowShowcase() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_70px_-42px_rgba(0,0,0,0.3)]">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 sm:px-5">
        <div>
          <p className="text-sm font-medium">stoke-example</p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-400">stoke/index.ts</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">Connected</span>
      </div>

      <div className="grid bg-zinc-200 lg:grid-cols-2 lg:gap-px">
        <section className="bg-zinc-950 text-zinc-300" aria-label="Stoke CLI example">
          <ShowcaseHeader icon={Terminal} label="CLI" dark />
          <div className="min-h-80 space-y-5 px-5 py-6 font-mono text-xs leading-6 sm:px-7">
            <Command text="stoke plan --workflow stoke-example" />
            <Output text="prepare-nextjs" detail="cached" />
            <Command text="stoke create demo --workflow stoke-example" />
            <Output text="demo" detail="workspace ready" />
            <Command text="stoke run demo test" />
            <Output text="tests" detail="2 passed" />
          </div>
        </section>

        <section className="bg-zinc-50 text-zinc-950" aria-label="Stoke dashboard example">
          <ShowcaseHeader icon={LayoutDashboard} label="Dashboard" />
          <div className="min-h-80 p-4 sm:p-5">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">stoke-example</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">Ben2W/stoke-example</p>
                </div>
                <div className="flex gap-2">
                  <span className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium">Plan</span>
                  <span className="rounded-md bg-zinc-950 px-2.5 py-1.5 text-[11px] font-medium text-white">Apply</span>
                </div>
              </div>
              <div className="divide-y divide-zinc-100">
                <DashboardRow label="prepare-nextjs" meta="Workflow" status="Cached" />
                <DashboardRow label="demo" meta="Workspace" status="Ready" />
                <DashboardRow label="Run tests" meta="Operation" status="Passed" />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-zinc-200 px-4 py-3 text-center text-xs text-zinc-500">
        <span>Same project</span><span className="text-zinc-300">·</span>
        <span>same workspaces</span><span className="text-zinc-300">·</span>
        <span>same run history</span>
      </div>
    </div>
  );
}

function ShowcaseHeader({ dark = false, icon: Icon, label }: { dark?: boolean; icon: typeof Terminal; label: string }) {
  return (
    <div className={`flex items-center gap-2 border-b px-5 py-3 text-xs font-medium ${dark ? "border-white/10 text-zinc-400" : "border-zinc-200 bg-white text-zinc-500"}`}>
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </div>
  );
}

function Command({ text }: { text: string }) {
  return <p><span className="mr-2 text-zinc-600">$</span><span className="text-white">{text}</span></p>;
}

function Output({ detail, text }: { detail: string; text: string }) {
  return <p className="flex items-center gap-2 text-zinc-500"><Check className="text-emerald-400" size={13} /> <span className="text-zinc-300">{text}</span><span>· {detail}</span></p>;
}

function DashboardRow({ label, meta, status }: { label: string; meta: string; status: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <CircleDot className="shrink-0 text-emerald-500" size={14} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{meta}</p>
      </div>
      <span className="text-[11px] text-zinc-500">{status}</span>
    </div>
  );
}
