"use client";

import { ArrowRight, LogOut } from "lucide-react";
import { useState } from "react";
import { authClient } from "../../lib/auth-client.ts";

export function SignInButton({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      className={compact
        ? "inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
        : "inline-flex h-11 items-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({ provider: "github", callbackURL: "/" });
      }}
      type="button"
    >
      {pending ? "Opening GitHub…" : "Sign in with GitHub"}
      <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
    </button>
  );
}

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-zinc-950 disabled:cursor-wait disabled:opacity-50"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut({
          fetchOptions: { onSuccess: () => window.location.assign("/") },
        });
      }}
      type="button"
    >
      <LogOut aria-hidden="true" size={14} strokeWidth={1.8} />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
