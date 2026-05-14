import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const REPO = "freestyle-sh/rigkit";

export function StarButton() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (cancelled || !data?.stargazers_count) return;
        setStars(data.stargazers_count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.a
      href={`https://github.com/${REPO}`}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.12 }}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--color-fg)] transition-colors hover:bg-[#f6f3eb]"
    >
      <GithubGlyph />
      <span>Star</span>
      {stars !== null && (
        <>
          <span className="text-[var(--color-border-strong)]">·</span>
          <span className="tabular-nums text-[var(--color-muted)]">
            {formatStars(stars)}
          </span>
        </>
      )}
    </motion.a>
  );
}

function formatStars(value: number): string {
  if (value < 1000) return value.toString();
  const k = value / 1000;
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}

function GithubGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="h-[12px] w-[12px]"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
