"use client";

import { Check, Clipboard } from "lucide-react";
import { useState } from "react";

const INSTALL_COMMAND = "bun add --global @usestoke/cli";

export function CliInstallCommand({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The command remains selectable when clipboard access is unavailable.
    }
  };

  return (
    <div className={`flex min-w-0 items-center rounded-md border border-zinc-200 bg-zinc-950 font-mono text-zinc-100 shadow-sm ${compact ? "min-h-9 px-2.5 py-2 text-[10px]" : "h-11 px-3 text-xs sm:text-sm"}`}>
      <span className="mr-2 shrink-0 text-emerald-400">$</span>
      <code className={`min-w-0 flex-1 ${compact ? "whitespace-normal leading-4" : "truncate"}`}>{INSTALL_COMMAND}</code>
      <button
        aria-label={copied ? "Install command copied" : "Copy install command"}
        className="ml-3 inline-flex shrink-0 items-center gap-1.5 text-zinc-400 transition hover:text-white"
        onClick={() => void copy()}
        type="button"
      >
        {copied ? <Check size={compact ? 12 : 14} /> : <Clipboard size={compact ? 12 : 14} />}
        <span className={compact ? "sr-only" : "hidden font-sans text-[10px] sm:inline"}>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
