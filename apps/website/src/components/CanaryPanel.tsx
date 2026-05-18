import { useEffect, useMemo, useState } from "react";

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

type NpmPackage = {
  name: string;
  distTag: string | null;
};

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; releases: ReleaseSummary[]; packages: NpmPackage[] };

const PACKAGES = [
  "@rigkit/cli",
  "@rigkit/sdk",
  "@rigkit/engine",
  "@rigkit/runtime-client",
  "@rigkit/provider-freestyle",
  "@rigkit/provider-cmux",
  "@rigkit/provider-gcloud-cli",
  "@rigkit/provider-vscode",
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function CanaryPanel() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [releasesResponse, ...packageResponses] = await Promise.all([
          fetch("/api/releases"),
          ...PACKAGES.map((name) =>
            fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`),
          ),
        ]);

        if (!releasesResponse.ok) {
          throw new Error(`Failed to load releases (${releasesResponse.status})`);
        }
        const releases = (await releasesResponse.json()) as ReleaseSummary[];

        const packages = await Promise.all(
          packageResponses.map(async (response, index): Promise<NpmPackage> => {
            const name = PACKAGES[index]!;
            if (!response.ok) return { name, distTag: null };
            const data = (await response.json()) as { "dist-tags"?: Record<string, string> };
            return { name, distTag: data["dist-tags"]?.canary ?? null };
          }),
        );

        if (!cancelled) setState({ status: "ready", releases, packages });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to load canary info",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canaries = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.releases.filter((release) => release.isCanary);
  }, [state]);

  if (state.status === "loading") {
    return <p className="font-mono text-[13px] text-[var(--color-dim)]">Loading canary…</p>;
  }

  if (state.status === "error") {
    return <p className="font-mono text-[13px] text-red-600">{state.message}</p>;
  }

  const currentCanaryTag = canaries[0]?.tag ?? null;

  return (
    <div className="flex flex-col gap-10">
      <section
        className="rounded-lg border-[1.5px] border-amber-500/60 bg-amber-50/70 p-5 font-mono text-[13px] leading-[1.55] text-[#3a2e10]"
      >
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-amber-700">
          Canary
        </p>
        <p className="mt-2">
          Canary builds publish from the tip of <code>main</code>. They are not
          versioned, may break without warning, and are intended for testing only.
          Pin to a stable release for anything you ship.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-[22px] font-semibold text-[var(--color-fg)]">
          Install
        </h2>
        <CodeBlock
          label="CLI"
          code="curl -fsSL https://rigkit.freestyle.sh/install/canary | sh"
        />
        <CodeBlock label="SDK" code="pnpm add @rigkit/sdk@canary" />
        <CodeBlock label="Engine" code="pnpm add @rigkit/engine@canary" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-[22px] font-semibold text-[var(--color-fg)]">
          Current canary version per package
        </h2>
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[12px] uppercase tracking-[0.08em] text-[var(--color-dim)]">
              <th className="py-2 pr-4 font-semibold">Package</th>
              <th className="py-2 font-semibold">@canary dist-tag</th>
            </tr>
          </thead>
          <tbody>
            {state.packages.map((pkg) => (
              <tr key={pkg.name} className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-4 text-[var(--color-fg)]">{pkg.name}</td>
                <td className="py-2 text-[var(--color-muted)]">
                  {pkg.distTag ?? <span className="text-[var(--color-dim)]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="font-mono text-[12px] text-[var(--color-dim)]">
          Latest canary GitHub release: {currentCanaryTag ? (
            <a
              href={canaries[0]!.htmlUrl}
              className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              {currentCanaryTag}
            </a>
          ) : (
            "none yet"
          )}
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-sans text-[22px] font-semibold text-[var(--color-fg)]">
          Canary history
        </h2>
        {canaries.length === 0 ? (
          <p className="font-mono text-[13px] text-[var(--color-dim)]">
            No canary releases published yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {canaries.slice(0, 20).map((release) => (
              <li
                key={release.tag}
                className="flex flex-wrap items-baseline gap-x-4 border-b border-[var(--color-border)] pb-3"
              >
                <a
                  href={release.htmlUrl}
                  className="font-mono text-[13px] text-[var(--color-fg)] underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {release.tag}
                </a>
                <span className="font-mono text-[12px] text-[var(--color-dim)]">
                  {formatDate(release.publishedAt ?? release.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
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
