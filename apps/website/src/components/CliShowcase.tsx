import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

type CommandStep = {
  kind: "command";
  text: string;
  typeMs: number;
  pauseAfterMs: number;
};

type OutputStep = {
  kind: "output";
  lines: { text: string; tone?: "ok" | "muted" | "default" }[];
  perLineMs: number;
  pauseAfterMs: number;
};

type IdeStep = {
  kind: "ide";
  durationMs: number;
};

type Step = CommandStep | OutputStep | IdeStep;

const SCRIPT: Step[] = [
  {
    kind: "command",
    text: "rig apply",
    typeMs: 480,
    pauseAfterMs: 220,
  },
  {
    kind: "output",
    lines: [
      { text: "▸ planning playground …", tone: "muted" },
      { text: "✓ create-vm           3.2s", tone: "ok" },
      { text: "✓ snapshot            0.8s", tone: "ok" },
      { text: "plan complete · 1 task applied", tone: "muted" },
    ],
    perLineMs: 360,
    pauseAfterMs: 700,
  },
  {
    kind: "command",
    text: "rig create workspace-1",
    typeMs: 740,
    pauseAfterMs: 200,
  },
  {
    kind: "output",
    lines: [
      { text: "▸ provisioning vm from snapshot …", tone: "muted" },
      { text: "✓ workspace-1 ready", tone: "ok" },
    ],
    perLineMs: 420,
    pauseAfterMs: 700,
  },
  {
    kind: "command",
    text: "rig run workspace-1/open",
    typeMs: 820,
    pauseAfterMs: 200,
  },
  {
    kind: "output",
    lines: [
      { text: "▸ opening cmux session …", tone: "muted" },
      { text: "✓ ssh forwarded · launching cmux", tone: "ok" },
    ],
    perLineMs: 380,
    pauseAfterMs: 350,
  },
  { kind: "ide", durationMs: 5200 },
];

type LineToken = { text: string; tone: "ok" | "muted" | "default" | "prompt" };
type Line = { id: string; tokens: LineToken[]; partial?: string };

const PROMPT = "$ ";

export function CliShowcase() {
  const [stepIndex, setStepIndex] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [showIde, setShowIde] = useState(false);
  const idCounter = useRef(0);
  const cycleRef = useRef(0);

  const nextId = () => {
    idCounter.current += 1;
    return `${cycleRef.current}-${idCounter.current}`;
  };

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const runStep = () => {
      const step = SCRIPT[stepIndex];
      if (!step) return;

      if (step.kind === "command") {
        const id = nextId();
        setLines((prev) => [
          ...prev,
          { id, tokens: [{ text: PROMPT, tone: "prompt" }], partial: "" },
        ]);

        const charDelay = step.typeMs / Math.max(step.text.length, 1);
        for (let i = 0; i < step.text.length; i++) {
          timers.push(
            setTimeout(() => {
              if (cancelled) return;
              setLines((prev) =>
                prev.map((line) =>
                  line.id === id
                    ? {
                        ...line,
                        partial: step.text.slice(0, i + 1),
                      }
                    : line,
                ),
              );
            }, charDelay * (i + 1)),
          );
        }

        timers.push(
          setTimeout(
            () => {
              if (cancelled) return;
              setLines((prev) =>
                prev.map((line) =>
                  line.id === id
                    ? {
                        id: line.id,
                        tokens: [
                          { text: PROMPT, tone: "prompt" },
                          { text: step.text, tone: "default" },
                        ],
                      }
                    : line,
                ),
              );
              setStepIndex((index) => index + 1);
            },
            step.typeMs + step.pauseAfterMs,
          ),
        );
        return;
      }

      if (step.kind === "output") {
        step.lines.forEach((line, i) => {
          timers.push(
            setTimeout(
              () => {
                if (cancelled) return;
                setLines((prev) => [
                  ...prev,
                  {
                    id: nextId(),
                    tokens: [{ text: line.text, tone: line.tone ?? "default" }],
                  },
                ]);
              },
              step.perLineMs * (i + 1),
            ),
          );
        });

        timers.push(
          setTimeout(
            () => {
              if (cancelled) return;
              setStepIndex((index) => index + 1);
            },
            step.perLineMs * step.lines.length + step.pauseAfterMs,
          ),
        );
        return;
      }

      if (step.kind === "ide") {
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            setShowIde(true);
          }, 120),
        );
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            setShowIde(false);
            cycleRef.current += 1;
            setLines([]);
            setStepIndex(0);
          }, step.durationMs),
        );
        return;
      }
    };

    runStep();
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [stepIndex]);

  return (
    <div className="relative w-full">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#faf8f2] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <TerminalChrome />
        <div className="relative h-[320px] sm:h-[360px]">
          <TerminalLog lines={lines} idle={!showIde} />
          <AnimatePresence>
            {showIde && <IdeWindow key="ide" />}
          </AnimatePresence>
        </div>
      </div>
      <p className="mt-3 font-mono text-[12px] text-[var(--color-muted)]">
        live preview · loops every {Math.round(estimatedCycleMs() / 1000)}s
      </p>
    </div>
  );
}

function estimatedCycleMs(): number {
  return SCRIPT.reduce((total, step) => {
    if (step.kind === "command") return total + step.typeMs + step.pauseAfterMs;
    if (step.kind === "output")
      return total + step.perLineMs * step.lines.length + step.pauseAfterMs;
    return total + step.durationMs;
  }, 0);
}

function TerminalChrome() {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[#f2efe7] px-4 py-2.5">
      <span className="inline-block h-[8px] w-[8px] rounded-full bg-[var(--color-border-strong)]" />
      <span className="font-mono text-[12px] text-[var(--color-muted)]">
        rig — playground
      </span>
    </div>
  );
}

function TerminalLog({ lines, idle }: { lines: Line[]; idle: boolean }) {
  const tail = lines[lines.length - 1];
  const tailIsCommand = tail?.partial !== undefined;

  return (
    <div className="absolute inset-0 overflow-hidden px-4 py-4 font-mono text-[13px] leading-[1.55] text-[var(--color-fg)]">
      <div className="flex h-full flex-col justify-end gap-[2px]">
        <AnimatePresence initial={false}>
          {lines.slice(0, lines.length - (tailIsCommand ? 1 : 0)).map((line) => (
            <motion.div
              key={line.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="whitespace-pre"
            >
              {line.tokens.map((token, i) => (
                <span key={i} className={toneClass(token.tone)}>
                  {token.text}
                </span>
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
        {tail && tailIsCommand && (
          <div className="whitespace-pre">
            <span className={toneClass("prompt")}>{PROMPT}</span>
            <span>{tail.partial}</span>
            {idle && <Cursor />}
          </div>
        )}
        {tail && !tailIsCommand && idle && (
          <div className="whitespace-pre">
            <span className={toneClass("prompt")}>{PROMPT}</span>
            <Cursor />
          </div>
        )}
      </div>
    </div>
  );
}

function toneClass(tone: LineToken["tone"]): string {
  switch (tone) {
    case "ok":
      return "text-[#1f8b4c]";
    case "muted":
      return "text-[var(--color-muted)]";
    case "prompt":
      return "text-[var(--color-accent)]";
    default:
      return "text-[var(--color-fg)]";
  }
}

function Cursor() {
  return (
    <motion.span
      aria-hidden="true"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      className="ml-[1px] inline-block h-[14px] w-[7px] -translate-y-[1px] align-middle bg-[var(--color-accent)]"
    />
  );
}

function IdeWindow() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 flex flex-col overflow-hidden bg-[#0f1115]"
    >
      <div className="flex items-center gap-3 border-b border-[#1f242c] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-[8px] w-[8px] rounded-full bg-[#3a414c]" />
          <span className="h-[8px] w-[8px] rounded-full bg-[#3a414c]" />
          <span className="h-[8px] w-[8px] rounded-full bg-[#3a414c]" />
        </div>
        <span className="font-mono text-[11px] text-[#7a8493]">
          cmux · workspace-1 — ssh: workspace-1.freestyle.dev
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-[#62d77a]">
          <span className="inline-block h-[6px] w-[6px] rounded-full bg-[#62d77a]" />
          connected
        </span>
      </div>
      <div className="grid flex-1 grid-cols-[112px_minmax(0,1fr)]">
        <FileTree />
        <Editor />
      </div>
      <div className="flex items-center justify-between border-t border-[#1f242c] bg-[#0a0d12] px-3 py-1.5 font-mono text-[10px] text-[#7a8493]">
        <span className="text-[#62d77a]">● main</span>
        <span>TypeScript · ⌘P open file</span>
      </div>
    </motion.div>
  );
}

function FileTree() {
  const items = useMemo(
    () => [
      { label: "src/", depth: 0 },
      { label: "index.ts", depth: 1, active: true },
      { label: "server.ts", depth: 1 },
      { label: "rig.config.ts", depth: 0 },
      { label: "package.json", depth: 0 },
    ],
    [],
  );
  return (
    <div className="border-r border-[#1f242c] bg-[#0c0f14] px-2 py-3 font-mono text-[11px]">
      <div className="mb-2 px-1 text-[10px] uppercase tracking-[0.1em] text-[#5a6473]">
        explorer
      </div>
      <ul className="space-y-[3px]">
        {items.map((item) => (
          <li
            key={item.label}
            className={`truncate rounded px-1.5 py-[2px] ${
              item.active
                ? "bg-[#1a2233] text-[#dfe7f5]"
                : "text-[#7a8493]"
            }`}
            style={{ paddingLeft: 6 + item.depth * 10 }}
          >
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

const EDITOR_LINES: { tokens: { text: string; cls: string }[] }[] = [
  {
    tokens: [
      { text: "import", cls: "text-[#c084fc]" },
      { text: " { defineConfig } ", cls: "text-[#dfe7f5]" },
      { text: "from", cls: "text-[#c084fc]" },
      { text: " ", cls: "text-[#dfe7f5]" },
      { text: '"@rigkit/sdk"', cls: "text-[#a7f3a0]" },
      { text: ";", cls: "text-[#dfe7f5]" },
    ],
  },
  { tokens: [{ text: "", cls: "" }] },
  {
    tokens: [
      { text: "export default", cls: "text-[#c084fc]" },
      { text: " defineConfig({", cls: "text-[#dfe7f5]" },
    ],
  },
  {
    tokens: [
      { text: "  workspace", cls: "text-[#dfe7f5]" },
      { text: ":", cls: "text-[#7a8493]" },
      { text: " ", cls: "text-[#dfe7f5]" },
      { text: '"workspace-1"', cls: "text-[#a7f3a0]" },
      { text: ",", cls: "text-[#7a8493]" },
    ],
  },
  {
    tokens: [
      { text: "  ssh", cls: "text-[#dfe7f5]" },
      { text: ":", cls: "text-[#7a8493]" },
      { text: " ", cls: "text-[#dfe7f5]" },
      { text: '"workspace-1.freestyle.dev"', cls: "text-[#a7f3a0]" },
      { text: ",", cls: "text-[#7a8493]" },
    ],
  },
  {
    tokens: [{ text: "});", cls: "text-[#dfe7f5]" }],
  },
];

function Editor() {
  return (
    <div className="relative overflow-hidden bg-[#0f1115] py-2 pl-2 pr-3 font-mono text-[11.5px] leading-[1.7]">
      <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2">
        {EDITOR_LINES.map((line, i) => (
          <Fragment key={i}>
            <span className="select-none text-right text-[#39414e]">
              {i + 1}
            </span>
            <motion.div
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.18 + i * 0.06, duration: 0.22 }}
              className="whitespace-pre"
            >
              {line.tokens.map((token, j) => (
                <span key={j} className={token.cls}>
                  {token.text}
                </span>
              ))}
            </motion.div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
