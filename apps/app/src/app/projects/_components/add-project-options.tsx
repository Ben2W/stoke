"use client";

import type { ManagedProject } from "@usestoke/managed";
import { Check, Clipboard, GitBranch, Laptop, Sparkles } from "lucide-react";
import { useState } from "react";

export const EXAMPLE_PROJECT_URL = "https://github.com/Ben2W/stoke-example";
const LOCAL_PROJECT_COMMAND = "stoke add .";

export function hasExampleProject(projects: ManagedProject[]): boolean {
  return projects.some((project) => project.source.kind === "github"
    && project.source.owner.toLowerCase() === "ben2w"
    && project.source.repository.toLowerCase() === "stoke-example");
}

export function ExampleProjectOption({ added, busy, error, onAdd, pending }: {
  added: boolean;
  busy: boolean;
  error?: string;
  onAdd(): void;
  pending: boolean;
}) {
  return (
    <div>
      <section className="flex items-center gap-4 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600"><Sparkles size={16} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-zinc-900">Stoke example</h3>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">A Next.js workflow using Vercel Sandbox, operations, and typed inputs.</p>
        </div>
        <button autoFocus={!added} className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${added ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-zinc-950 text-white hover:bg-zinc-800"}`} disabled={added || busy} onClick={onAdd} type="button">
          {pending ? <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : added ? <Check size={13} /> : <Sparkles size={13} />}
          {pending ? "Adding…" : added ? "Added" : "Add example"}
        </button>
      </section>
      {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}

export function GitHubProjectOption({ busy, error, onChange, onSubmit, pending, url }: {
  busy: boolean;
  error?: string;
  onChange(value: string): void;
  onSubmit(): void;
  pending: boolean;
  url: string;
}) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <label className="text-xs font-medium text-zinc-700" htmlFor="github-repository-url">Public GitHub repository URL</label>
      <div className="mt-2 flex gap-2">
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md border border-zinc-300 px-3 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-100">
          <GitBranch className="shrink-0 text-zinc-400" size={15} />
          <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" id="github-repository-url" onChange={(event) => onChange(event.target.value)} placeholder="https://github.com/owner/repository" spellCheck={false} type="url" value={url} />
        </div>
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50" disabled={!url.trim() || busy} type="submit">
          {pending ? <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <GitBranch size={13} />}
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
    </form>
  );
}

export function LocalProjectOption() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(LOCAL_PROJECT_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <section className="rounded-lg border border-zinc-200 p-4">
      <div className="flex gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Laptop size={15} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-medium text-zinc-800">Connect the current local checkout</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Run this inside your repository to associate its path with this machine.</p>
          <button className="mt-3 flex h-10 w-full items-center justify-between rounded-md bg-zinc-950 px-3 font-mono text-[11px] text-zinc-100 transition hover:bg-zinc-800" onClick={() => void copy()} type="button">
            <span>$ {LOCAL_PROJECT_COMMAND}</span>
            <span className="inline-flex items-center gap-1.5 font-sans text-[10px] text-zinc-400">{copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
