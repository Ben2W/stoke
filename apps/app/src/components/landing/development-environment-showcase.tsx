"use client";

import { Check, CircleDashed, Code2, ExternalLink, GitBranch, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

type OutputLine = { text: string; tone: "default" | "muted" | "ok" };

const createCommand = "stoke create demo stoke-example";
const createOutput: OutputLine[] = [
  { text: "▸ creating Vercel Sandbox …", tone: "default" },
  { text: "  restoring stoke-example from shared cache", tone: "muted" },
  { text: "✓ demo ready                 3.8s", tone: "ok" },
];
const openCommand = "stoke run demo open-cmux";
const openOutput: OutputLine[] = [
  { text: "▸ opening demo in cmux …", tone: "default" },
  { text: "  connecting SSH · forwarding port 3000", tone: "muted" },
  { text: "✓ cmux workspace ready", tone: "ok" },
];

const createTypeMs = 760;
const createOutputStartMs = createTypeMs + 260;
const createLineMs = 380;
const openCommandStartMs = createOutputStartMs + createOutput.length * createLineMs + 620;
const openTypeMs = 680;
const openOutputStartMs = openCommandStartMs + openTypeMs + 240;
const openLineMs = 390;
const cmuxRevealMs = openOutputStartMs + openOutput.length * openLineMs + 120;

export function DevelopmentEnvironmentShowcase() {
  const [cycle, setCycle] = useState(0);
  const [createLength, setCreateLength] = useState(0);
  const [createLineCount, setCreateLineCount] = useState(0);
  const [openLength, setOpenLength] = useState(0);
  const [openLineCount, setOpenLineCount] = useState(0);
  const [showCmux, setShowCmux] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setCreateLength(reducedMotion ? createCommand.length : 0);
    setCreateLineCount(reducedMotion ? createOutput.length : 0);
    setOpenLength(reducedMotion ? openCommand.length : 0);
    setOpenLineCount(reducedMotion ? openOutput.length : 0);
    setShowCmux(reducedMotion);
    if (reducedMotion) return;

    scheduleTyping(timers, setCreateLength, createCommand, 0, createTypeMs);
    createOutput.forEach((_, index) => timers.push(setTimeout(
      () => setCreateLineCount(index + 1),
      createOutputStartMs + createLineMs * index,
    )));
    scheduleTyping(timers, setOpenLength, openCommand, openCommandStartMs, openTypeMs);
    openOutput.forEach((_, index) => timers.push(setTimeout(
      () => setOpenLineCount(index + 1),
      openOutputStartMs + openLineMs * index,
    )));
    timers.push(setTimeout(() => setShowCmux(true), cmuxRevealMs));
    timers.push(setTimeout(() => setCycle((value) => value + 1), cmuxRevealMs + 3_200));

    return () => timers.forEach(clearTimeout);
  }, [cycle]);

  const showOpenCommand = openLength > 0;
  return (
    <div className="grid overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 shadow-[0_24px_70px_-42px_rgba(0,0,0,0.3)] lg:grid-cols-[0.92fr_1.08fr] lg:gap-px">
      <section className="flex min-h-[23rem] flex-col bg-zinc-950 text-zinc-300" aria-label="Animated Stoke workspace commands">
        <WindowHeader icon={Terminal} label="terminal" dark />
        <div className="flex-1 overflow-hidden px-5 py-6 font-mono text-xs leading-6 sm:px-7">
          <CommandLine cursor={!createLineCount} text={createCommand.slice(0, createLength)} />
          <OutputLines cycle={cycle} lines={createOutput.slice(0, createLineCount)} />
          {showOpenCommand ? (
            <div className="mt-5">
              <CommandLine cursor={!openLineCount} text={openCommand.slice(0, openLength)} />
              <OutputLines cycle={cycle} lines={openOutput.slice(0, openLineCount)} offset={createOutput.length} />
            </div>
          ) : null}
        </div>
      </section>

      <section className="flex min-h-[23rem] flex-col bg-zinc-50" aria-label="cmux workspace preview">
        <WindowHeader icon={Code2} label={showCmux ? "demo — cmux" : "workspace · idle"} />
        {showCmux ? (
          <CmuxWorkspace cycle={cycle} />
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <CircleDashed className="mx-auto animate-spin text-zinc-300" size={20} />
              <p className="mt-3 font-mono text-xs text-zinc-400">waiting for <code className="text-zinc-700">demo/open-cmux</code>…</p>
            </div>
          </div>
        )}
      </section>
      <p className="sr-only">Stoke creates the demo workspace, then opens it in cmux with SSH and the development preview connected.</p>
    </div>
  );
}

function CmuxWorkspace({ cycle }: { cycle: number }) {
  return (
    <div className="grid flex-1 grid-cols-[7.5rem_minmax(0,1fr)] bg-white" key={cycle} style={{ animation: "stoke-terminal-line 260ms ease-out both" }}>
      <aside className="border-r border-zinc-200 bg-zinc-100/80 p-3 text-zinc-500">
        <div className="mb-4 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          <span className="size-1.5 rounded-full bg-emerald-500" /> cmux
        </div>
        <div className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-[10px] text-zinc-900 shadow-xs">
          <p className="truncate font-medium">demo</p>
          <p className="mt-1 truncate text-zinc-400">stoke-example</p>
        </div>
        <div className="mt-3 space-y-2 px-2 text-[9px] text-zinc-400">
          <p className="flex items-center gap-1.5 text-zinc-700"><Terminal size={9} /> terminal</p>
          <p className="flex items-center gap-1.5"><ExternalLink size={9} /> preview</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-9 items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2">
          <span className="rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[9px] text-zinc-800 shadow-xs">terminal</span>
          <span className="rounded px-2 py-1 font-mono text-[9px] text-zinc-400">localhost:3000</span>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-2 bg-zinc-200 sm:grid-cols-2 sm:grid-rows-1">
          <div className="bg-[#faf9f6] p-4 font-mono text-[10px] leading-5 text-zinc-500">
            <p><span className="text-emerald-700">demo</span> <span className="text-zinc-400">~/app</span></p>
            <p className="mt-2 text-zinc-800">$ bun dev</p>
            <p>ready on <span className="text-zinc-700">localhost:3000</span></p>
            <p className="mt-2 text-emerald-700">✓ connected over SSH</p>
          </div>
          <div className="bg-white p-4">
            <div className="flex items-center gap-1.5 text-[9px] text-zinc-400"><GitBranch size={9} /> Ben2W/stoke-example</div>
            <div className="mt-4 h-3 w-3/4 rounded bg-zinc-900" />
            <div className="mt-2 h-2 w-full rounded bg-zinc-200" />
            <div className="mt-1.5 h-2 w-4/5 rounded bg-zinc-100" />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="h-12 rounded border border-zinc-200 bg-zinc-50" />
              <div className="h-12 rounded border border-zinc-200 bg-zinc-50" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WindowHeader({ dark = false, icon: Icon, label }: { dark?: boolean; icon: typeof Terminal; label: string }) {
  return (
    <div className={`flex h-11 items-center gap-2 border-b px-4 font-mono text-[11px] ${dark ? "border-white/10 text-zinc-500" : "border-zinc-200 bg-white text-zinc-500"}`}>
      <Icon size={12} /> {label}
    </div>
  );
}

function CommandLine({ cursor, text }: { cursor: boolean; text: string }) {
  return (
    <p className="whitespace-pre">
      <span className="mr-2 text-zinc-600">$</span><span className="text-white">{text}</span>
      {cursor ? <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-1.5 -translate-y-px animate-pulse bg-emerald-400 align-middle" /> : null}
    </p>
  );
}

function OutputLines({ cycle, lines, offset = 0 }: { cycle: number; lines: OutputLine[]; offset?: number }) {
  return (
    <div className="mt-2 space-y-0.5">
      {lines.map((line, index) => (
        <p
          className={`whitespace-pre ${toneClass(line.tone)}`}
          key={`${cycle}:${offset + index}`}
          style={{ animation: "stoke-terminal-line 180ms ease-out both" }}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}

function scheduleTyping(
  timers: ReturnType<typeof setTimeout>[],
  setLength: (length: number) => void,
  text: string,
  startMs: number,
  durationMs: number,
): void {
  const charDelay = durationMs / text.length;
  for (let index = 1; index <= text.length; index += 1) {
    timers.push(setTimeout(() => setLength(index), startMs + charDelay * index));
  }
}

function toneClass(tone: OutputLine["tone"]): string {
  if (tone === "ok") return "text-emerald-400";
  if (tone === "muted") return "text-zinc-500";
  return "text-zinc-300";
}
