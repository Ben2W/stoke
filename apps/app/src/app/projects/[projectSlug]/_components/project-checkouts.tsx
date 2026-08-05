"use client";

import type { ManagedCheckout } from "@usestoke/managed";
import { GitBranch, Laptop, MapPin } from "lucide-react";

export function ProjectCheckouts({ checkouts }: { checkouts: ManagedCheckout[] }) {
  return (
    <section className="mt-8" aria-labelledby="checkouts-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium" id="checkouts-heading">Local checkouts</h2>
          <p className="mt-1 text-xs text-zinc-500">Optional filesystem copies of this Git repository.</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-zinc-400">{checkouts.length} linked</span>
      </div>
      {checkouts.length ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs">
          <ul className="divide-y divide-zinc-100">
            {checkouts.map((checkout) => (
              <li className="flex items-start gap-3 px-4 py-3.5" key={checkout.id}>
                <div className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Laptop size={15} /></div>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs font-medium text-zinc-800">{checkout.deviceName}</strong>
                  <span className="mt-1 flex items-center gap-1 truncate text-[11px] text-zinc-400"><MapPin size={10} /> {checkout.path}</span>
                </span>
                <span className="hidden items-center gap-1 text-[10px] text-zinc-400 sm:flex"><GitBranch size={10} /> Git checkout</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-7 text-center">
          <p className="text-xs text-zinc-500">No local checkout is required. To link one, run <code className="rounded bg-zinc-100 px-1.5 py-0.5">stoke add /path/to/repo</code>.</p>
        </div>
      )}
    </section>
  );
}
