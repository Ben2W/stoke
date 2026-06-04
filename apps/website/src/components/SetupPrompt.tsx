import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

const DOCS_API = "curl https://www.rigkit.dev/docs/bash";
const PROMPT = `Help me set up a Rigkit workspace in this repo. Use the Rigkit docs API: ${DOCS_API}`;

export function SetupPrompt() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="w-full">
      <motion.button
        type="button"
        onClick={handleCopy}
        aria-label="Copy setup prompt"
        whileTap={{ scale: 0.995 }}
        transition={{ duration: 0.08 }}
        className="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-left shadow-[0_1px_0_rgba(10,10,10,0.04)] transition-colors hover:bg-[#fbf9f3]"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5">
          <span
            aria-hidden="true"
            className="mt-[2px] select-none font-mono text-sm text-[var(--color-accent)]"
          >
            ›
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1 font-mono text-[13.5px] leading-[1.6]">
            <span className="text-[var(--color-fg)]">
              Help me set up a Rigkit workspace in this repo. Use the Rigkit docs
              API:
            </span>
            <span className="text-[var(--color-accent)]">{DOCS_API}</span>
          </div>
        </div>
        <motion.span
          aria-hidden="true"
          animate={
            copied
              ? { backgroundColor: "#0f9d58" }
              : { backgroundColor: "#0a0a0a" }
          }
          transition={{ duration: 0.18 }}
          className="mt-0.5 inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 font-sans text-[13px] font-semibold text-white"
        >
          <span className="relative grid h-[14px] w-[14px] place-items-center">
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="check"
                  initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 grid place-items-center"
                >
                  <CheckIcon />
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="absolute inset-0 grid place-items-center"
                >
                  <CopyIcon />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="relative inline-block min-w-[44px] text-left">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? "copied" : "copy"}
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -6, opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute inset-0"
              >
                {copied ? "Copied" : "Copy"}
              </motion.span>
            </AnimatePresence>
            <span className="invisible">{copied ? "Copied" : "Copy"}</span>
          </span>
        </motion.span>
      </motion.button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5L6.5 12 13 4.5" />
    </svg>
  );
}
