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

type IdeStep = { kind: "ide" };

type Step = CommandStep | OutputStep | IdeStep;

const PREVIEW_HOST = "workspace-1-sad145.style.dev";

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
      { text: "▸ clone-and-install …", tone: "muted" },
      { text: "  cloning vercel/next.js-starter", tone: "muted" },
      { text: "  bun install · 132 packages", tone: "muted" },
      { text: "✓ clone-and-install   8.7s", tone: "ok" },
      { text: "plan complete · 1 task applied", tone: "muted" },
    ],
    perLineMs: 380,
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
      { text: "▸ booting vm from snapshot …", tone: "muted" },
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
      { text: "▸ starting dev server on port 3000", tone: "muted" },
      { text: `✓ forwarded → ${PREVIEW_HOST}`, tone: "ok" },
      { text: "✓ opening vs code …", tone: "ok" },
    ],
    perLineMs: 380,
    pauseAfterMs: 250,
  },
  { kind: "ide" },
];

type LineToken = { text: string; tone: "ok" | "muted" | "default" | "prompt" };
type Line = { id: string; tokens: LineToken[]; partial?: string };

const PROMPT = "$ ";

export function CliShowcase() {
  const [stepIndex, setStepIndex] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [showIde, setShowIde] = useState(false);
  const idCounter = useRef(0);

  const nextId = () => {
    idCounter.current += 1;
    return `${idCounter.current}`;
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
            setTimeout(
              () => {
                if (cancelled) return;
                setLines((prev) =>
                  prev.map((line) =>
                    line.id === id
                      ? { ...line, partial: step.text.slice(0, i + 1) }
                      : line,
                  ),
                );
              },
              charDelay * (i + 1),
            ),
          );
        }

        timers.push(
          setTimeout(() => {
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
          }, step.typeMs + step.pauseAfterMs),
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#faf8f2] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <ChromeBar label="rig — playground" />
        <div className="h-[340px] sm:h-[380px]">
          <TerminalLog lines={lines} idle={!showIde} />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <AnimatePresence mode="wait">
          {showIde ? (
            <motion.div
              key="ide"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="h-[340px] sm:h-[380px]"
            >
              <TabbedWindow />
            </motion.div>
          ) : (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex h-[340px] flex-col sm:h-[380px]"
            >
              <ChromeBar label="workspace · idle" />
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <p className="font-mono text-[13px] text-[var(--color-dim)]">
                  waiting for{" "}
                  <code className="text-[var(--color-fg)]">
                    workspace-1/open
                  </code>
                  …
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ChromeBar({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[#f2efe7] px-4 py-2.5">
      <span className="inline-block h-[8px] w-[8px] rounded-full bg-[var(--color-border-strong)]" />
      <span className="font-mono text-[12px] text-[var(--color-muted)]">
        {label}
      </span>
    </div>
  );
}

function TerminalLog({ lines, idle }: { lines: Line[]; idle: boolean }) {
  const tail = lines[lines.length - 1];
  const tailIsCommand = tail?.partial !== undefined;

  return (
    <div className="relative h-full overflow-hidden px-4 py-4 font-mono text-[13px] leading-[1.55] text-[var(--color-fg)]">
      <div className="flex h-full flex-col gap-[2px]">
        <AnimatePresence initial={false}>
          {lines
            .slice(0, lines.length - (tailIsCommand ? 1 : 0))
            .map((line) => (
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

type TabId = "vscode" | "browser";

function TabbedWindow() {
  const [active, setActive] = useState<TabId>("vscode");

  useEffect(() => {
    const t1 = setTimeout(() => setActive("browser"), 2400);
    return () => clearTimeout(t1);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-stretch gap-1 border-b border-[var(--color-border)] bg-[#f2efe7] px-2 pt-2">
        <Tab
          label="VS Code · workspace-1"
          icon={<VsCodeGlyph />}
          active={active === "vscode"}
          onClick={() => setActive("vscode")}
        />
        <Tab
          label={PREVIEW_HOST}
          icon={<GlobeGlyph />}
          active={active === "browser"}
          onClick={() => setActive("browser")}
        />
      </div>
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {active === "vscode" ? (
            <motion.div
              key="vscode"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <VsCodePane />
            </motion.div>
          ) : (
            <motion.div
              key="browser"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <BrowserPane />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Tab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex max-w-[200px] items-center gap-1.5 truncate rounded-t-md border border-b-0 px-3 py-1.5 font-mono text-[11.5px] transition-colors ${
        active
          ? "border-[var(--color-border)] bg-[#0f1115] text-[#dfe7f5]"
          : "border-transparent bg-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      }`}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function VsCodeGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="h-[10px] w-[10px]"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M11.5 2 4 8l7.5 6V2Z" />
      <path d="M4 8l-2.5-1.5L11.5 2v12L1.5 9.5 4 8Z" />
    </svg>
  );
}

function GlobeGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="h-[10px] w-[10px]"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </svg>
  );
}

function VsCodePane() {
  return (
    <div className="flex h-full flex-col bg-[#0f1115]">
      <div className="grid flex-1 grid-cols-[124px_minmax(0,1fr)]">
        <FileTree />
        <Editor />
      </div>
      <div className="flex items-center justify-between border-t border-[#1f242c] bg-[#0a0d12] px-3 py-1.5 font-mono text-[10px] text-[#7a8493]">
        <span className="text-[#62d77a]">● ssh: workspace-1</span>
        <span>TypeScript · main</span>
      </div>
    </div>
  );
}

function FileTree() {
  const items = useMemo(
    () => [
      { label: "app/", depth: 0 },
      { label: "layout.tsx", depth: 1 },
      { label: "page.tsx", depth: 1, active: true },
      { label: "public/", depth: 0 },
      { label: "package.json", depth: 0 },
      { label: "rig.config.ts", depth: 0 },
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
              item.active ? "bg-[#1a2233] text-[#dfe7f5]" : "text-[#7a8493]"
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
      { text: "export default function ", cls: "text-[#c084fc]" },
      { text: "Page", cls: "text-[#fde68a]" },
      { text: "() {", cls: "text-[#dfe7f5]" },
    ],
  },
  {
    tokens: [
      { text: "  return", cls: "text-[#c084fc]" },
      { text: " (", cls: "text-[#dfe7f5]" },
    ],
  },
  {
    tokens: [
      { text: "    <", cls: "text-[#7a8493]" },
      { text: "main", cls: "text-[#7dd3fc]" },
      { text: " className=", cls: "text-[#dfe7f5]" },
      { text: '"grid place-items-center min-h-screen"', cls: "text-[#a7f3a0]" },
      { text: ">", cls: "text-[#7a8493]" },
    ],
  },
  {
    tokens: [
      { text: "      <", cls: "text-[#7a8493]" },
      { text: "h1", cls: "text-[#7dd3fc]" },
      { text: ">Hello from workspace-1</", cls: "text-[#dfe7f5]" },
      { text: "h1", cls: "text-[#7dd3fc]" },
      { text: ">", cls: "text-[#7a8493]" },
    ],
  },
  {
    tokens: [
      { text: "    </", cls: "text-[#7a8493]" },
      { text: "main", cls: "text-[#7dd3fc]" },
      { text: ">", cls: "text-[#7a8493]" },
    ],
  },
  {
    tokens: [{ text: "  );", cls: "text-[#dfe7f5]" }],
  },
  {
    tokens: [{ text: "}", cls: "text-[#dfe7f5]" }],
  },
];

function Editor() {
  return (
    <div className="relative overflow-hidden bg-[#0f1115] py-2 pl-2 pr-3 font-mono text-[11.5px] leading-[1.75]">
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

function BrowserPane() {
  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[#f6f3eb] px-3 py-2">
        <NavButtons />
        <div className="flex flex-1 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[11.5px]">
          <LockGlyph />
          <span className="truncate">
            <span className="text-[var(--color-muted)]">https://</span>
            <span className="text-[var(--color-fg)]">{PREVIEW_HOST}</span>
          </span>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden bg-[var(--color-bg)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-full flex-col items-center justify-center px-6 text-center"
        >
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-muted)]">
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-[#1f8b4c]" />
            next dev · port 3000
          </span>
          <h2 className="font-sans text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--color-fg)]">
            Hello from workspace-1
          </h2>
          <p className="mt-2 font-mono text-[11.5px] text-[var(--color-muted)]">
            edit <code className="text-[var(--color-fg)]">app/page.tsx</code>{" "}
            and save — HMR ships in &lt; 200ms
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function NavButtons() {
  return (
    <div className="flex shrink-0 items-center gap-1 text-[var(--color-dim)]">
      <NavArrow direction="left" />
      <NavArrow direction="right" />
      <NavReload />
    </div>
  );
}

function NavArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      className="grid h-[18px] w-[18px] place-items-center rounded hover:bg-[var(--color-border)]/40"
    >
      <svg
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[8px] w-[8px]"
        style={{ transform: direction === "right" ? "rotate(180deg)" : "none" }}
      >
        <path d="M6 1.5 2.5 5 6 8.5" />
      </svg>
    </button>
  );
}

function NavReload() {
  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      className="grid h-[18px] w-[18px] place-items-center rounded hover:bg-[var(--color-border)]/40"
    >
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[9px] w-[9px]"
      >
        <path d="M2 6a4 4 0 0 1 7-2.6" />
        <path d="M9 1.6V3.6H7" />
        <path d="M10 6a4 4 0 0 1-7 2.6" />
        <path d="M3 10.4V8.4h2" />
      </svg>
    </button>
  );
}

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className="h-[10px] w-[10px] text-[var(--color-muted)]"
    >
      <rect x="2" y="4.5" width="6" height="4" rx="0.8" />
      <path d="M3.5 4.5V3a1.5 1.5 0 0 1 3 0v1.5" />
    </svg>
  );
}
