import { useEffect, useState } from "react";

type LatestMetadata = {
  version: string;
  tag: string;
};

export function LatestVersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/latest.json");
        if (!response.ok) return;
        const data = (await response.json()) as LatestMetadata;
        if (!cancelled) setVersion(data.version);
      } catch {
        // Silent: badge falls back to "Rigkit".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      href="/releases"
      className="mb-7 inline-flex items-center self-start rounded-lg border-[1.5px] border-[var(--color-accent)] px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)] transition-opacity hover:opacity-80"
    >
      {version ? `Rigkit · v${shortVersion(version)}` : "Rigkit"}
    </a>
  );
}

function shortVersion(version: string): string {
  const [major, minor] = version.split(".");
  if (major === undefined || minor === undefined) return version;
  return `${major}.${minor}`;
}
