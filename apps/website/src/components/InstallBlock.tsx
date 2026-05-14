import { useState } from "react";

const COMMAND = "curl -fsSL https://rigkit.freestyle.sh/install | sh";

export function InstallBlock() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-stretch gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[0_1px_0_rgba(10,10,10,0.04)]">
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
          <span aria-hidden="true" className="font-mono text-sm text-[var(--color-dim)]">
            $
          </span>
          <code className="truncate font-mono text-sm text-[var(--color-fg)]">
            {COMMAND}
          </code>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy install command"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--color-fg)] px-4 py-2 font-sans text-sm font-semibold text-white transition-colors hover:bg-[#1f1f1f] disabled:opacity-60"
        >
          {copied ? (
            <>
              <CheckIcon />
              Copied
            </>
          ) : (
            <>
              <CopyIcon />
              Copy
            </>
          )}
        </button>
      </div>
      <p className="mt-3 font-mono text-xs text-[var(--color-muted)]">
        macOS &amp; Linux · darwin/linux · arm64/x64
      </p>
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
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5L6.5 12 13 4.5" />
    </svg>
  );
}
