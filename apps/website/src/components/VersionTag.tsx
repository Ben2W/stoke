import { useEffect, useState } from "react";

type LatestMetadata = {
  version: string;
  tag: string;
};

export function VersionTag() {
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
        // Silent: tag stays hidden until a version is known.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  return (
    <a
      href="/releases"
      className="font-mono text-[11px] font-medium text-[var(--color-accent)] transition-opacity hover:opacity-80"
    >
      v{shortVersion(version)}
    </a>
  );
}

function shortVersion(version: string): string {
  const [major, minor] = version.split(".");
  if (major === undefined || minor === undefined) return version;
  return `${major}.${minor}`;
}
