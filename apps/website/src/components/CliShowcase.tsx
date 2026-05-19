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
      { text: "▸ creating branch workspace-1", tone: "muted" },
      { text: "✓ workspace-1 ready", tone: "ok" },
    ],
    perLineMs: 380,
    pauseAfterMs: 700,
  },
  {
    kind: "command",
    text: "rig run workspace-1 open",
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

export function CliShowcase({ configHtml }: { configHtml: string }) {
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
            setStepIndex((index) => index + 1);
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

  const [leftTab, setLeftTab] = useState<"terminal" | "config">("terminal");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#faf8f2] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <div className="flex items-stretch gap-1 border-b border-[var(--color-border)] bg-[#f2efe7] px-2 pt-2">
          <Tab
            label="terminal"
            icon={<TerminalGlyph />}
            active={leftTab === "terminal"}
            onClick={() => setLeftTab("terminal")}
          />
          <Tab
            label="rig.config.ts"
            icon={<FileGlyph />}
            active={leftTab === "config"}
            onClick={() => setLeftTab("config")}
          />
        </div>
        <div className="relative h-[340px] sm:h-[380px]">
          <div
            className={`absolute inset-0 ${leftTab === "terminal" ? "" : "pointer-events-none opacity-0"}`}
            aria-hidden={leftTab !== "terminal"}
          >
            <TerminalLog lines={lines} idle={stepIndex >= SCRIPT.length} />
          </div>
          <div
            className={`absolute inset-0 overflow-auto ${leftTab === "config" ? "" : "pointer-events-none opacity-0"}`}
            aria-hidden={leftTab !== "config"}
          >
            <ConfigPane html={configHtml} />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <AnimatePresence mode="wait">
          {showIde ? (
            <motion.div
              key="ide"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="flex min-h-0 flex-1 flex-col"
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
              className="flex min-h-0 flex-1 flex-col"
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

function ConfigPane({ html }: { html: string }) {
  return (
    <div
      className="config-pane h-full px-4 py-3 font-mono text-[12.5px] leading-[1.6]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function TerminalGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[10px] w-[10px]"
    >
      <path d="M3 5l3 3-3 3" />
      <path d="M8.5 11h4.5" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      className="h-[10px] w-[10px]"
    >
      <path d="M3.5 2h5.5L13 5.5V14H3.5z" />
      <path d="M9 2v3.5H13" />
    </svg>
  );
}

function ChromeBar({ label }: { label: string }) {
  return (
    <div className="flex items-center border-b border-[var(--color-border)] bg-[#f2efe7] px-4 py-2.5">
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
          ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]"
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
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="grid flex-1 grid-cols-[124px_minmax(0,1fr)]">
        <FileTree />
        <Editor />
      </div>
      <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[10px] text-white">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[5px] w-[5px] rounded-full bg-[#a7f3a0]" />
          ssh: workspace-1
        </span>
        <span className="text-white/85">TypeScript · main</span>
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
    <div className="border-r border-[var(--color-border)] bg-[#f6f3eb] px-2 py-3 font-mono text-[11px]">
      <div className="mb-2 px-1 text-[10px] uppercase tracking-[0.1em] text-[var(--color-dim)]">
        explorer
      </div>
      <ul className="space-y-[3px]">
        {items.map((item) => (
          <li
            key={item.label}
            className={`truncate rounded px-1.5 py-[2px] ${
              item.active
                ? "bg-[var(--color-accent-soft)] text-[var(--color-fg)]"
                : "text-[var(--color-muted)]"
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
      { text: "export default function ", cls: "text-[#0000ff]" },
      { text: "Page", cls: "text-[#795e26]" },
      { text: "() {", cls: "text-[#0a0a0a]" },
    ],
  },
  {
    tokens: [
      { text: "  return", cls: "text-[#af00db]" },
      { text: " (", cls: "text-[#0a0a0a]" },
    ],
  },
  {
    tokens: [
      { text: "    <", cls: "text-[#800000]" },
      { text: "main", cls: "text-[#800000]" },
      { text: ">", cls: "text-[#800000]" },
    ],
  },
  {
    tokens: [
      { text: "      <", cls: "text-[#800000]" },
      { text: "h1", cls: "text-[#800000]" },
      { text: ">Hello World</", cls: "text-[#0a0a0a]" },
      { text: "h1", cls: "text-[#800000]" },
      { text: ">", cls: "text-[#800000]" },
    ],
  },
  {
    tokens: [
      { text: "    </", cls: "text-[#800000]" },
      { text: "main", cls: "text-[#800000]" },
      { text: ">", cls: "text-[#800000]" },
    ],
  },
  {
    tokens: [{ text: "  );", cls: "text-[#0a0a0a]" }],
  },
  {
    tokens: [{ text: "}", cls: "text-[#0a0a0a]" }],
  },
];

function Editor() {
  return (
    <div className="relative overflow-hidden bg-[var(--color-surface)] py-2 pl-2 pr-3 font-mono text-[11.5px] leading-[1.75]">
      <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2">
        {EDITOR_LINES.map((line, i) => (
          <Fragment key={i}>
            <span className="select-none text-right text-[#b8b0a0]">
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
            Hello World
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
