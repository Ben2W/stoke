"use client";

import { Check, CircleDashed, CircleDot, LayoutDashboard, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

type OutputTone = "default" | "muted" | "ok";
type OutputLine = { text: string; tone: OutputTone };
type DashboardStatus = "cached" | "completed" | "pending" | "running";

const command = "stoke apply";
const typeMs = 560;
const outputStartMs = typeMs + 260;
const perLineMs = 420;
const output: OutputLine[] = [
  { text: "▸ resolving workflow stoke-example …", tone: "muted" },
  { text: "✓ prepare-nextjs           cached", tone: "ok" },
  { text: "▸ provision-sandbox …", tone: "default" },
  { text: "  creating Vercel Sandbox", tone: "muted" },
  { text: "✓ provision-sandbox        4.2s", tone: "ok" },
  { text: "✓ apply complete · 2 tasks · 1 cached", tone: "ok" },
];

export function WorkflowShowcase() {
  const [cycle, setCycle] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const [visibleLineCount, setVisibleLineCount] = useState(0);
  const complete = visibleLineCount === output.length;
  const applying = typedLength > 0 && !complete;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setTypedLength(reducedMotion ? command.length : 0);
    setVisibleLineCount(reducedMotion ? output.length : 0);
    if (reducedMotion) return;

    const charDelay = typeMs / command.length;
    for (let index = 1; index <= command.length; index += 1) {
      timers.push(setTimeout(() => setTypedLength(index), charDelay * index));
    }
    output.forEach((_, index) => {
      timers.push(setTimeout(
        () => setVisibleLineCount(index + 1),
        outputStartMs + perLineMs * index,
      ));
    });
    timers.push(setTimeout(
      () => setCycle((value) => value + 1),
      outputStartMs + perLineMs * output.length + 2_600,
    ));

    return () => timers.forEach(clearTimeout);
  }, [cycle]);

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
        <section className="bg-zinc-950 text-zinc-300" aria-label="Animated Stoke CLI example">
          <ShowcaseHeader icon={Terminal} label="CLI" dark />
          <div className="min-h-80 overflow-hidden px-5 py-6 font-mono text-xs leading-6 sm:px-7">
            <p className="whitespace-pre">
              <span className="mr-2 text-zinc-600">$</span>
              <span className="text-white">{command.slice(0, typedLength)}</span>
              {!visibleLineCount ? <Cursor /> : null}
            </p>
            <div className="mt-5 space-y-1">
              {output.slice(0, visibleLineCount).map((line, index) => (
                <p
                  className={`whitespace-pre ${outputToneClass(line.tone)}`}
                  key={`${cycle}:${index}`}
                  style={{ animation: "stoke-terminal-line 180ms ease-out both" }}
                >
                  {line.text}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-zinc-50 text-zinc-950" aria-label="Animated Stoke dashboard example">
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
                  <span className={`inline-flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${complete ? "bg-emerald-600 text-white" : "bg-zinc-950 text-white"}`}>
                    {applying ? <CircleDashed className="animate-spin" size={11} /> : complete ? <Check size={11} /> : null}
                    {applying ? "Applying" : complete ? "Applied" : "Apply"}
                  </span>
                </div>
              </div>
              <div className="divide-y divide-zinc-100">
                <DashboardRow label="prepare-nextjs" meta="Workflow task" status={prepareStatus(visibleLineCount)} />
                <DashboardRow label="provision-sandbox" meta="Workflow task" status={sandboxStatus(visibleLineCount)} />
              </div>
              <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-[10px] text-zinc-400">
                <span>Shared project state</span>
                <span className={complete ? "text-emerald-600" : ""}>{complete ? "Applied just now" : applying ? "Run in progress" : "Ready to apply"}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-zinc-200 px-4 py-3 text-center text-xs text-zinc-500">
        <span>Same project</span><span className="text-zinc-300">·</span>
        <span>same cache</span><span className="text-zinc-300">·</span>
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

function Cursor() {
  return <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-1.5 -translate-y-px animate-pulse bg-emerald-400 align-middle" />;
}

function DashboardRow({ label, meta, status }: { label: string; meta: string; status: DashboardStatus }) {
  const complete = status === "cached" || status === "completed";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {status === "running" ? (
        <CircleDashed className="shrink-0 animate-spin text-blue-500" size={14} />
      ) : complete ? (
        <Check className="shrink-0 text-emerald-500" size={14} />
      ) : (
        <CircleDot className="shrink-0 text-zinc-300" size={14} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{meta}</p>
      </div>
      <span className={`text-[11px] capitalize ${complete ? "text-emerald-600" : status === "running" ? "text-blue-600" : "text-zinc-400"}`}>{status}</span>
    </div>
  );
}

function prepareStatus(visibleLineCount: number): DashboardStatus {
  if (visibleLineCount < 1) return "pending";
  if (visibleLineCount < 2) return "running";
  return "cached";
}

function sandboxStatus(visibleLineCount: number): DashboardStatus {
  if (visibleLineCount < 3) return "pending";
  if (visibleLineCount < 5) return "running";
  return "completed";
}

function outputToneClass(tone: OutputTone): string {
  if (tone === "ok") return "text-emerald-400";
  if (tone === "muted") return "text-zinc-500";
  return "text-zinc-300";
}
