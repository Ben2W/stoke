"use client";

import { ArrowRight, LogOut } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "../../lib/auth-client.ts";
import { queryKeys } from "../../lib/queries.ts";

export function SignInButton({ compact = false }: { compact?: boolean }) {
  const signIn = useMutation({
    mutationFn: async () => {
      await authClient.signIn.social({ provider: "github", callbackURL: "/" });
    },
  });

  return (
    <button
      className={compact
        ? "inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
        : "inline-flex h-11 items-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"}
      disabled={signIn.isPending}
      onClick={() => signIn.mutate()}
      type="button"
    >
      {signIn.isPending ? "Opening GitHub…" : "Sign in with GitHub"}
      <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
    </button>
  );
}

export function SignOutButton() {
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: async () => {
      await authClient.signOut();
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.currentUser, null);
      queryClient.removeQueries({ queryKey: queryKeys.projects });
      queryClient.removeQueries({ queryKey: queryKeys.checkouts });
      queryClient.removeQueries({ queryKey: queryKeys.runs });
    },
  });

  return (
    <button
      className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-zinc-950 disabled:cursor-wait disabled:opacity-50"
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
      type="button"
    >
      <LogOut aria-hidden="true" size={14} strokeWidth={1.8} />
      {signOut.isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}
