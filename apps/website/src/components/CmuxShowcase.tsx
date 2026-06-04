import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Workspace = {
  id: string;
  title: string;
  preview: string;
  branch: string;
  task: string;
  host: string;
};

const WORKSPACES: Workspace[] = [
  {
    id: "agent-frontend-refactor",
    title: "agent-frontend-refactor",
    preview:
      "Splitting <Showcase/> into smaller pieces and lifting state to the page level…",
    branch: "agent/frontend-refactor",
    task: "refactor the home showcase into composable parts",
    host: "frontend-refactor-3f81.style.dev",
  },
  {
    id: "agent-seo-optimization",
    title: "agent-seo-optimization",
    preview:
      "Adding canonical tags, OG images, and JSON-LD for the marketing pages…",
    branch: "agent/seo-optimization",
    task: "audit and improve seo on the marketing site",
    host: "seo-optimization-9c42.style.dev",
  },
];

type CommandStep = {
  kind: "command";
  text: string;
  typeMs: number;
  pauseAfterMs: number;
};

type OutputStep = {
  kind: "output";
  lines: { text: string; tone?: "ok" | "muted" | "default" | "table" }[];
  perLineMs: number;
  pauseAfterMs: number;
};

type OpenCmuxStep = {
  kind: "open";
  workspaceId: string;
  delayMs: number;
};

type Step = CommandStep | OutputStep | OpenCmuxStep;

const SCRIPT: Step[] = [
  {
    kind: "command",
    text: "rig ls",
    typeMs: 360,
    pauseAfterMs: 220,
  },
  {
    kind: "output",
    lines: [
      {
        text: "WORKSPACE                     STATUS    AUTH",
        tone: "muted",
      },
      {
        text: "agent-frontend-refactor       ready     ✓ ben",
        tone: "table",
      },
      {
        text: "agent-seo-optimization        ready     ✓ ben",
        tone: "table",
      },
      {
        text: "agent-payment-flow            ready     ✓ ben",
        tone: "table",
      },
      {
        text: "agent-onboarding-emails       ready     ✓ ben",
        tone: "table",
      },
      {
        text: "agent-flaky-test-fix          ready     ✓ ben",
        tone: "table",
      },
      {
        text: "+ 5 more · all forked from one authenticated snapshot",
        tone: "muted",
      },
    ],
    perLineMs: 90,
    pauseAfterMs: 700,
  },
  {
    kind: "command",
    text: "rig run agent-frontend-refactor open-cmux",
    typeMs: 980,
    pauseAfterMs: 180,
  },
  {
    kind: "output",
    lines: [
      { text: "▸ resolving workspace agent-frontend-refactor", tone: "muted" },
      { text: "✓ opening cmux → agent/frontend-refactor", tone: "ok" },
    ],
    perLineMs: 320,
    pauseAfterMs: 180,
  },
  { kind: "open", workspaceId: "agent-frontend-refactor", delayMs: 80 },
  {
    kind: "command",
    text: "rig run agent-seo-optimization open-cmux",
    typeMs: 940,
    pauseAfterMs: 180,
  },
  {
    kind: "output",
    lines: [
      { text: "▸ resolving workspace agent-seo-optimization", tone: "muted" },
      { text: "✓ opening cmux → agent/seo-optimization", tone: "ok" },
    ],
    perLineMs: 320,
    pauseAfterMs: 200,
  },
  { kind: "open", workspaceId: "agent-seo-optimization", delayMs: 80 },
];

type LineToken = {
  text: string;
  tone: "ok" | "muted" | "default" | "prompt" | "table";
};
type Line = { id: string; tokens: LineToken[]; partial?: string };

const PROMPT = "$ ";

export function CmuxShowcase() {
  const [stepIndex, setStepIndex] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [openWorkspaces, setOpenWorkspaces] = useState<string[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );
  const idCounter = useRef(0);

  const nextId = () => {
    idCounter.current += 1;
    return `c-${idCounter.current}`;
  };

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

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
    }

    if (step.kind === "open") {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setOpenWorkspaces((prev) =>
            prev.includes(step.workspaceId)
              ? prev
              : [...prev, step.workspaceId],
          );
          setActiveWorkspaceId(step.workspaceId);
          setStepIndex((index) => index + 1);
        }, step.delayMs),
      );
    }

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [stepIndex]);

  const idle = stepIndex >= SCRIPT.length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#faf8f2] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <div className="flex items-center border-b border-[var(--color-border)] bg-[#f2efe7] px-4 py-2.5">
          <span className="font-mono text-[12px] text-[var(--color-muted)]">
            terminal
          </span>
        </div>
        <div className="h-[340px] sm:h-[380px]">
          <TerminalLog lines={lines} idle={idle} />
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[#f2efe7] px-3 py-2">
          <span className="font-mono text-[12px] text-[var(--color-muted)]">
            cmux
          </span>
          <span className="font-mono text-[10.5px] text-[var(--color-dim)]">
            {openWorkspaces.length} workspace
            {openWorkspaces.length === 1 ? "" : "s"}
          </span>
        </div>
        <CmuxBody
          openWorkspaceIds={openWorkspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={setActiveWorkspaceId}
        />
      </div>
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
                transition={{ duration: 0.16, ease: "easeOut" }}
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
    case "table":
      return "text-[var(--color-fg)]";
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

function CmuxBody({
  openWorkspaceIds,
  activeWorkspaceId,
  onSelect,
}: {
  openWorkspaceIds: string[];
  activeWorkspaceId: string | null;
  onSelect: (id: string) => void;
}) {
  const openItems = openWorkspaceIds
    .map((id) => WORKSPACES.find((w) => w.id === id))
    .filter((w): w is Workspace => Boolean(w));
  const active = WORKSPACES.find((w) => w.id === activeWorkspaceId) ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-1 border-r border-[var(--color-border)] bg-[#f6f3eb] p-2">
        {openItems.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center">
            <p className="font-mono text-[11px] text-[var(--color-dim)]">
              no sessions yet
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {openItems.map((ws) => (
              <motion.button
                key={ws.id}
                type="button"
                onClick={() => onSelect(ws.id)}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className={`flex cursor-pointer flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors ${
                  activeWorkspaceId === ws.id
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-transparent bg-transparent hover:bg-[#ece8db]"
                }`}
              >
                <span
                  className={`truncate font-mono text-[11px] font-medium ${
                    activeWorkspaceId === ws.id
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-fg)]"
                  }`}
                >
                  {ws.title}
                </span>
                <span className="line-clamp-2 font-sans text-[10.5px] leading-[1.4] text-[var(--color-muted)]">
                  {ws.preview}
                </span>
                <span className="truncate font-mono text-[9.5px] text-[var(--color-dim)]">
                  {ws.branch}
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        )}
      </aside>
      <main className="relative flex min-h-0 flex-col bg-[var(--color-surface)]">
        <AnimatePresence mode="wait">
          {active ? (
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <SessionTabs workspace={active} />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[#f2efe7] px-2 pt-2">
                <div className="px-2 py-1 font-mono text-[10.5px] text-[var(--color-dim)]">
                  cmux idle
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <p className="font-mono text-[11.5px] text-[var(--color-dim)]">
                  waiting for{" "}
                  <code className="text-[var(--color-fg)]">
                    rig run … open-cmux
                  </code>
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

type SessionTabId = "claude" | "website";

function SessionTabs({ workspace }: { workspace: Workspace }) {
  const [tab, setTab] = useState<SessionTabId>("claude");

  useEffect(() => {
    setTab("claude");
  }, [workspace.id]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-stretch gap-1 border-b border-[var(--color-border)] bg-[#f2efe7] px-2 pt-2">
        <SessionTab
          label="Claude Code"
          icon={<SparkleGlyph />}
          active={tab === "claude"}
          onClick={() => setTab("claude")}
        />
        <SessionTab
          label="Website"
          icon={<GlobeGlyph />}
          active={tab === "website"}
          onClick={() => setTab("website")}
        />
      </div>
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {tab === "claude" ? (
            <motion.div
              key="claude"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <ClaudeSession workspace={workspace} />
            </motion.div>
          ) : (
            <motion.div
              key="website"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <WebsitePane workspace={workspace} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SessionTab({
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
      className={`flex max-w-[200px] cursor-pointer items-center gap-1.5 truncate rounded-t-md border border-b-0 px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
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

function WebsitePane({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[#f6f3eb] px-3 py-2">
        <div className="flex shrink-0 items-center gap-1 text-[var(--color-dim)]">
          <NavArrow direction="left" />
          <NavArrow direction="right" />
          <NavReload />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[11px]">
          <LockGlyph />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-[var(--color-muted)]">https://</span>
            <span className="text-[var(--color-fg)]">{workspace.host}</span>
          </span>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden bg-[var(--color-bg)]">
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-muted)]">
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-[#1f8b4c]" />
            next dev · port 3000
          </span>
          <h2 className="font-sans text-[22px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--color-fg)]">
            Hello World
          </h2>
          <p className="mt-2 font-mono text-[10px] text-[var(--color-muted)]">
            edit app/page.tsx and save — HMR ships in &lt; 200ms
          </p>
        </div>
      </div>
    </div>
  );
}

function GlobeGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-[10px] w-[10px]"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </svg>
  );
}

function NavArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-[18px] w-[18px] place-items-center rounded"
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
    </span>
  );
}

function NavReload() {
  return (
    <span
      aria-hidden="true"
      className="grid h-[18px] w-[18px] place-items-center rounded"
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
    </span>
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

function ClaudeSession({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex h-full flex-col px-3 pt-2.5 pb-2 font-mono text-[11.5px] leading-[1.55] text-[var(--color-fg)]">
      <div className="rounded-md border border-[#d96a2d]/55 bg-[#fdf6ef] px-3 py-2">
        <div className="text-[10.5px] text-[#b8551f]">Claude Code v2.1.143</div>
        <div className="mt-1.5 text-[var(--color-fg)]">Welcome back Ben!</div>
        <div className="mt-1.5 text-[10.5px] text-[var(--color-muted)]">
          Opus 4.7 (1M context) · {workspace.branch}
        </div>
      </div>
      <div className="mt-2.5 text-[10.5px] text-[#b8551f]">
        Tips for getting started
      </div>
      <div className="text-[10.5px] text-[var(--color-muted)]">
        Run /init to create a CLAUDE.md file with instructions for Claude
      </div>
      <div className="mt-3 flex items-start gap-1.5">
        <span className="mt-[1px] text-[var(--color-accent)]">›</span>
        <span className="text-[var(--color-fg)]">{workspace.task}</span>
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-muted)]">
        <span className="text-[#b8551f]">»</span>
        <span>bypass permissions on</span>
        <span className="text-[var(--color-dim)]">(shift+tab to cycle)</span>
      </div>
    </div>
  );
}

function SparkleGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[9px] w-[9px] text-[#b8551f]"
    >
      <path d="M6 1.5v9M1.5 6h9M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}
