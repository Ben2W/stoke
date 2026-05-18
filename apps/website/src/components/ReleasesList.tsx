import { useEffect, useState } from "react";
import { marked } from "marked";

type ReleaseSummary = {
  tag: string;
  name: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string | null;
  createdAt: string | null;
  htmlUrl: string;
  isCanary: boolean;
};

marked.setOptions({ gfm: true, breaks: false });

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; releases: ReleaseSummary[] };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function ReleasesList() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/releases");
        if (!response.ok) {
          throw new Error(`Failed to load releases (${response.status})`);
        }
        const releases = (await response.json()) as ReleaseSummary[];
        if (!cancelled) setState({ status: "ready", releases });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to load releases",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="font-mono text-[13px] text-[var(--color-dim)]">Loading releases…</p>;
  }

  if (state.status === "error") {
    return <p className="font-mono text-[13px] text-red-600">{state.message}</p>;
  }

  const stable = state.releases.filter((release) => !release.prerelease);
  if (stable.length === 0) {
    return <p className="font-mono text-[13px] text-[var(--color-dim)]">No releases published yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-8">
      {stable.map((release) => (
        <li
          key={release.tag}
          className="border-l-2 border-[var(--color-border-strong)] pl-5"
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <a
              href={`/releases/${release.tag}`}
              className="font-sans text-[18px] font-semibold text-[var(--color-fg)] underline-offset-4 hover:underline"
            >
              {release.tag}
            </a>
            <span className="font-mono text-[12px] text-[var(--color-dim)]">
              {formatDate(release.publishedAt ?? release.createdAt)}
            </span>
            <a
              href={release.htmlUrl}
              className="font-mono text-[12px] text-[var(--color-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub →
            </a>
          </div>
          {release.body ? (
            <ReleaseBody markdown={release.body} />
          ) : (
            <p className="mt-3 font-mono text-[13px] italic text-[var(--color-dim)]">
              No release notes.
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReleaseBody({ markdown }: { markdown: string }) {
  const html = marked.parse(markdown.trim(), { async: false }) as string;
  return (
    <div
      className="release-notes mt-3 font-sans text-[14px] leading-[1.6] text-[#2a2a2a]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return dateFormatter.format(parsed);
}
