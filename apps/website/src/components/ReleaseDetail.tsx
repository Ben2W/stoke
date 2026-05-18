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

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; release: ReleaseSummary };

marked.setOptions({ gfm: true, breaks: false });

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PACKAGES = [
  "@rigkit/cli",
  "@rigkit/sdk",
  "@rigkit/engine",
  "@rigkit/runtime-client",
  "@rigkit/fragments",
  "@rigkit/provider-freestyle",
  "@rigkit/provider-cmux",
  "@rigkit/provider-gcloud-cli",
  "@rigkit/provider-vscode",
];

export function ReleaseDetail() {
  const [tag, setTag] = useState<string | null>(null);
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    const match = window.location.pathname.match(/^\/releases\/(.+?)\/?$/);
    if (!match) {
      setState({ status: "error", message: "Invalid release URL" });
      return;
    }
    const decoded = decodeURIComponent(match[1]!);
    setTag(decoded);
  }, []);

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/releases");
        if (!response.ok) {
          throw new Error(`Failed to load releases (${response.status})`);
        }
        const releases = (await response.json()) as ReleaseSummary[];
        const release = releases.find((entry) => entry.tag === tag);
        if (!release) {
          throw new Error(`Release ${tag} not found`);
        }
        if (!cancelled) setState({ status: "ready", release });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to load release",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tag]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <p className="font-mono text-[13px] text-[var(--color-dim)]">Loading release…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <p className="font-mono text-[13px] text-red-600">{state.message}</p>
      </div>
    );
  }

  const { release } = state;
  const versionStripped = release.tag.startsWith("v") ? release.tag.slice(1) : release.tag;
  const cliInstall = `curl -fsSL https://rigkit.dev/install/version/${release.tag} | sh`;

  return (
    <div className="flex flex-col gap-10">
      <BackLink />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="font-sans text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[var(--color-fg)]">
            {release.tag}
          </h1>
          {release.prerelease ? (
            <span className="rounded-md border border-amber-500/60 bg-amber-50/70 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
              Pre-release
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-[var(--color-dim)]">
          <span>{formatDate(release.publishedAt ?? release.createdAt)}</span>
          <a
            href={release.htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--color-accent)] underline-offset-4 hover:underline"
          >
            View on GitHub →
          </a>
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-[22px] font-semibold text-[var(--color-fg)]">
          Install this version
        </h2>
        <CodeBlock label="CLI" code={cliInstall} />
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer font-mono text-[12px] text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            Pin npm packages to {versionStripped}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {PACKAGES.map((pkg) => (
              <code
                key={pkg}
                className="block rounded-md border border-[var(--color-border)] bg-[var(--color-term-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-fg)]"
              >
                pnpm add {pkg}@{versionStripped}
              </code>
            ))}
          </div>
        </details>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-sans text-[22px] font-semibold text-[var(--color-fg)]">
          Release notes
        </h2>
        {release.body ? (
          <div
            className="release-notes font-sans text-[14px] leading-[1.6] text-[#2a2a2a]"
            dangerouslySetInnerHTML={{ __html: marked.parse(release.body.trim(), { async: false }) as string }}
          />
        ) : (
          <p className="font-mono text-[13px] italic text-[var(--color-dim)]">
            No release notes.
          </p>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <a
      href="/releases"
      className="inline-flex items-center gap-1.5 self-start font-mono text-[13px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]"
    >
      <span aria-hidden="true">←</span>
      All releases
    </a>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-dim)]">
        {label}
      </span>
      <code className="block rounded-md border border-[var(--color-border)] bg-[var(--color-term-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-fg)]">
        {code}
      </code>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return dateFormatter.format(parsed);
}
