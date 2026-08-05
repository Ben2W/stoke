"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../lib/auth-client.ts";
import {
  decideDeviceAuthorization,
  getDeviceAuthorization,
  StokeApiError,
} from "../../lib/api-client.ts";
import { currentUserQuery, queryKeys } from "../../lib/queries.ts";

export function DeviceAuthorization() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [userCode, setUserCode] = useState(searchParams.get("user_code") ?? "");
  const user = useQuery(currentUserQuery);
  const authorization = useQuery({
    queryKey: queryKeys.deviceAuthorization(userCode),
    queryFn: () => getDeviceAuthorization(userCode),
    enabled: Boolean(userCode && user.data),
    retry: false,
  });
  const signIn = useMutation({
    mutationFn: async () => {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: `/device?user_code=${encodeURIComponent(userCode)}`,
      });
    },
  });
  const decision = useMutation({
    mutationFn: decideDeviceAuthorization,
    onSuccess: (_, input) => {
      queryClient.setQueryData(
        queryKeys.deviceAuthorization(input.userCode),
        input.action === "approve" ? "approved" : "denied",
      );
    },
  });

  if (user.isPending) {
    return <section className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">Loading authorization request…</section>;
  }

  const error = authorization.error ?? decision.error ?? signIn.error;
  const message = error instanceof StokeApiError && typeof error.body === "object" && error.body
    && "error_description" in error.body && typeof error.body.error_description === "string"
    ? error.body.error_description
    : error instanceof Error ? error.message : undefined;
  const status = authorization.data;

  return (
    <section className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-7 shadow-sm sm:p-10">
      <div className="text-xs font-medium text-zinc-500">Stoke CLI authorization</div>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Connect this terminal?</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-600">
        Confirm the code shown by <code>stoke login</code>. Only approve terminals you recognize.
      </p>

      <label className="mt-7 block text-xs font-medium text-zinc-700" htmlFor="device-code">Device code</label>
      <input
        id="device-code"
        className="mt-2 h-12 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 font-mono text-lg uppercase tracking-[0.14em] outline-none transition placeholder:text-zinc-300 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-100"
        value={userCode}
        onChange={(event) => setUserCode(event.target.value.toUpperCase())}
        placeholder="ABCD-EFGH"
        autoComplete="one-time-code"
      />

      {!user.data ? (
        <button className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40" disabled={!userCode || signIn.isPending} onClick={() => signIn.mutate()}>
          {signIn.isPending ? "Opening GitHub…" : "Sign in with GitHub"}
        </button>
      ) : status === "approved" ? (
        <p className="mt-5 text-sm text-emerald-600">Terminal connected. You can return to the CLI.</p>
      ) : status === "denied" ? (
        <p className="mt-5 text-sm text-red-600">Request denied.</p>
      ) : (
        <div className="mt-4 flex gap-2">
          <button className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40" disabled={status !== "pending" || decision.isPending} onClick={() => decision.mutate({ action: "approve", userCode })}>
            Approve
          </button>
          <button className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40" disabled={status !== "pending" || decision.isPending} onClick={() => decision.mutate({ action: "deny", userCode })}>
            Deny
          </button>
        </div>
      )}

      {(authorization.isFetching || decision.isPending) && <p className="mt-4 text-xs text-zinc-500">Checking device code…</p>}
      {message && <p className="mt-4 text-sm text-red-600">{message}</p>}
      {user.data && <p className="mt-5 border-t border-zinc-100 pt-4 text-xs text-zinc-500">Signed in as {user.data.email}</p>}
    </section>
  );
}
