import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export type ConfigSnippet = {
  id: string;
  label: string;
  blurb: string;
  html: string;
  interactive?: boolean;
};

export function ConfigShowcase({ snippets }: { snippets: ConfigSnippet[] }) {
  const [activeId, setActiveId] = useState<string>(
    () => snippets.find((s) => s.interactive)?.id ?? snippets[0]!.id,
  );
  const active = snippets.find((s) => s.id === activeId) ?? snippets[0]!;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_0_rgba(10,10,10,0.04)]">
      <div className="flex flex-wrap items-stretch gap-1 border-b border-[var(--color-border)] bg-[#f2efe7] px-2 pt-2">
        {snippets.map((snippet) => (
          <button
            key={snippet.id}
            type="button"
            onClick={() => setActiveId(snippet.id)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 font-mono text-[12px] transition-colors ${
              activeId === snippet.id
                ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]"
                : "border-transparent bg-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {snippet.label}
            {snippet.interactive && (
              <span
                className={`ml-0.5 rounded-full px-1.5 py-[1px] text-[9.5px] uppercase tracking-[0.1em] ${
                  activeId === snippet.id
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "bg-[#ece8db] text-[var(--color-muted)]"
                }`}
              >
                live
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="px-4 pt-3 pb-2 sm:px-5">
        <p className="font-sans text-[13px] leading-[1.5] text-[var(--color-muted)]">
          {active.blurb}
        </p>
      </div>

      {active.interactive ? (
        <div className="grid grid-cols-1 gap-px border-t border-[var(--color-border)] bg-[var(--color-border)] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <CodePane html={active.html} />
          <InteractiveAuthPane key={active.id} />
        </div>
      ) : (
        <div className="border-t border-[var(--color-border)]">
          <CodePane html={active.html} />
        </div>
      )}
    </div>
  );
}

function CodePane({ html }: { html: string }) {
  return (
    <div className="bg-[var(--color-surface)]">
      <div
        className="config-pane max-h-[460px] overflow-auto px-5 py-4 font-mono text-[13px] leading-[1.6] sm:px-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

type AuthStep =
  | { kind: "command"; text: string; typeMs: number; pauseAfterMs: number }
  | {
      kind: "output";
      lines: { text: string; tone?: AuthTone }[];
      perLineMs: number;
      pauseAfterMs: number;
    }
  | { kind: "popup-open"; delayMs: number }
  | { kind: "popup-stream"; delayMs: number }
  | { kind: "popup-auth"; delayMs: number }
  | { kind: "popup-close"; delayMs: number };

type AuthTone = "ok" | "muted" | "default" | "warn";

const DEVICE_CODE = "G3R4-9XAB";
const DEVICE_URL = "https://github.com/login/device";
const GH_USER = "ben";

const MAIN_PROMPT = "$ ";

const AUTH_SCRIPT: AuthStep[] = [
  { kind: "command", text: "rig apply", typeMs: 440, pauseAfterMs: 220 },
  {
    kind: "output",
    lines: [
      { text: "▸ setup > github-auth …", tone: "muted" },
      { text: "  gh auth status -h github.com", tone: "muted" },
      { text: "  not authenticated — opening interactive terminal", tone: "muted" },
    ],
    perLineMs: 340,
    pauseAfterMs: 120,
  },
  { kind: "popup-open", delayMs: 120 },
  { kind: "popup-stream", delayMs: 1300 },
  { kind: "popup-auth", delayMs: 4400 },
  { kind: "popup-close", delayMs: 1200 },
  {
    kind: "output",
    lines: [
      { text: "✓ github-auth   18.2s", tone: "ok" },
      { text: "plan complete · 1 task applied", tone: "muted" },
    ],
    perLineMs: 360,
    pauseAfterMs: 200,
  },
];

type LineToken = { text: string; tone: AuthTone | "prompt" };
type Line = { id: string; tokens: LineToken[]; partial?: string };

type PopupState = "hidden" | "spawning" | "waiting" | "authed";

function InteractiveAuthPane() {
  const [stepIndex, setStepIndex] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [popupState, setPopupState] = useState<PopupState>("hidden");
  const idCounter = useRef(0);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextId = () => {
    idCounter.current += 1;
    return `auth-${idCounter.current}`;
  };

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const step = AUTH_SCRIPT[stepIndex];
    if (!step) return;

    if (step.kind === "command") {
      const id = nextId();
      setLines((prev) => [
        ...prev,
        { id, tokens: [{ text: MAIN_PROMPT, tone: "prompt" }], partial: "" },
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
                      { text: MAIN_PROMPT, tone: "prompt" },
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

    if (step.kind === "popup-open") {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setPopupState("spawning");
          setStepIndex((index) => index + 1);
        }, step.delayMs),
      );
    }

    if (step.kind === "popup-stream") {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setPopupState("waiting");
          setStepIndex((index) => index + 1);
        }, step.delayMs),
      );
    }

    if (step.kind === "popup-auth") {
      const timer = setTimeout(() => {
        if (cancelled) return;
        setPopupState("authed");
        setStepIndex((index) => index + 1);
      }, step.delayMs);
      timers.push(timer);
      skipTimerRef.current = timer;
    }

    if (step.kind === "popup-close") {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setPopupState("hidden");
          setStepIndex((index) => index + 1);
        }, step.delayMs),
      );
    }

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [stepIndex]);

  const skipWait = () => {
    if (popupState !== "waiting") return;
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
    setPopupState("authed");
    setStepIndex((index) => index + 1);
  };

  const idle = stepIndex >= AUTH_SCRIPT.length;

  return (
    <div className="relative flex min-h-0 flex-col bg-[#faf8f2]">
      <div className="flex items-center border-b border-[var(--color-border)] bg-[#f2efe7] px-4 py-2.5">
        <span className="font-mono text-[12px] text-[var(--color-muted)]">
          terminal
        </span>
      </div>
      <div className="relative h-[380px] sm:h-[420px]">
        <MainTerminal lines={lines} idle={idle && popupState === "hidden"} />
        <AnimatePresence>
          {popupState !== "hidden" && (
            <motion.div
              key="popup"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-3 bottom-3 top-12 sm:inset-x-5 sm:top-14"
            >
              <PopupTerminal state={popupState} onContinue={skipWait} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MainTerminal({ lines, idle }: { lines: Line[]; idle: boolean }) {
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
            <span className={toneClass("prompt")}>{MAIN_PROMPT}</span>
            <span>{tail.partial}</span>
            <Cursor />
          </div>
        )}
      </div>
    </div>
  );
}

function PopupTerminal({
  state,
  onContinue,
}: {
  state: Exclude<PopupState, "hidden">;
  onContinue: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_12px_28px_-14px_rgba(10,10,10,0.18)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[#f2efe7] px-3 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-fg)]">
          <SshGlyph />
          Log in to GitHub
        </span>
        <span className="font-mono text-[10px] text-[var(--color-dim)]">
          interactive terminal
        </span>
      </div>
      <div className="relative flex flex-1 min-h-0 flex-col gap-[2px] overflow-hidden bg-[#faf8f2] px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] text-[var(--color-fg)]">
        <PopupLine prompt="root@vm-3f81 ~ #">
          <span className="text-[var(--color-fg)]">
            gh auth login --hostname github.com --web
          </span>
        </PopupLine>
        {state !== "spawning" && (
          <>
            <PopupLine plain>
              <span className="text-[#b8551f]">!</span>{" "}
              <span className="text-[var(--color-fg)]">
                First copy your one-time code:
              </span>{" "}
              <span className="font-semibold tracking-[0.05em] text-[var(--color-fg)]">
                {DEVICE_CODE}
              </span>
            </PopupLine>
            <PopupLine plain>
              <span className="text-[var(--color-muted)]">
                Press Enter to open
              </span>{" "}
              <button
                type="button"
                onClick={onContinue}
                className="cursor-pointer text-[var(--color-accent)] underline-offset-2 hover:underline"
                disabled={state !== "waiting"}
              >
                {DEVICE_URL}
              </button>{" "}
              <span className="text-[var(--color-muted)]">
                in your browser…
              </span>
            </PopupLine>
          </>
        )}
        {state === "authed" && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-1 flex flex-col gap-[2px]"
          >
            <PopupLine plain>
              <span className="text-[var(--color-muted)]">
                Authentication complete.
              </span>
            </PopupLine>
            <PopupLine plain>
              <span className="text-[#1f8b4c]">✓</span>{" "}
              <span className="text-[var(--color-fg)]">
                Logged in as @{GH_USER}
              </span>
            </PopupLine>
          </motion.div>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-[var(--color-border)] pt-1.5 text-[10px] text-[var(--color-dim)]">
          <span>
            instructions: Complete the GitHub login in this terminal.
          </span>
          {state === "waiting" && (
            <span
              className="inline-flex items-center gap-1.5 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--color-accent)]"
              aria-live="polite"
            >
              <Spinner />
              Authorizing
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PopupLine({
  children,
  prompt,
  plain,
}: {
  children: React.ReactNode;
  prompt?: string;
  plain?: boolean;
}) {
  return (
    <div className="whitespace-pre-wrap">
      {prompt ? (
        <span className="text-[var(--color-accent)]">{prompt} </span>
      ) : plain ? null : null}
      {children}
    </div>
  );
}

function toneClass(tone: LineToken["tone"]): string {
  switch (tone) {
    case "ok":
      return "text-[#1f8b4c]";
    case "muted":
      return "text-[var(--color-muted)]";
    case "warn":
      return "text-[#b8551f]";
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

function Spinner() {
  return (
    <motion.span
      aria-hidden="true"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
      className="inline-block h-[9px] w-[9px] rounded-full border-[1.5px] border-[var(--color-accent)]/30 border-t-[var(--color-accent)]"
    />
  );
}

function SshGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[10px] w-[10px] text-[var(--color-muted)]"
    >
      <path d="M2 4l2 2-2 2" />
      <path d="M6 8h4" />
    </svg>
  );
}
