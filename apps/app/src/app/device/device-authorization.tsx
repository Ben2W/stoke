"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "../../lib/auth-client.ts";

type DeviceState = "idle" | "checking" | "ready" | "approved" | "denied" | "error";

export function DeviceAuthorization() {
  const searchParams = useSearchParams();
  const [userCode, setUserCode] = useState(searchParams.get("user_code") ?? "");
  const [state, setState] = useState<DeviceState>(userCode ? "checking" : "idle");
  const [message, setMessage] = useState("");
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!userCode || !session) return;
    let cancelled = false;
    setState("checking");
    fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error_description ?? "Invalid or expired device code");
        if (!cancelled) setState(body.status === "pending" ? "ready" : body.status);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, userCode]);

  async function signIn() {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: `/device?user_code=${encodeURIComponent(userCode)}`,
    });
  }

  async function decide(action: "approve" | "deny") {
    setState("checking");
    const response = await fetch(`/api/auth/device/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error_description ?? `Could not ${action} this device`);
      setState("error");
      return;
    }
    setState(action === "approve" ? "approved" : "denied");
  }

  if (isPending) return <section className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">Loading authorization request…</section>;

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
        onChange={(event) => {
          setUserCode(event.target.value.toUpperCase());
          setState("idle");
        }}
        placeholder="ABCD-EFGH"
        autoComplete="one-time-code"
      />

      {!session ? (
        <button className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40" disabled={!userCode} onClick={signIn}>
          Sign in with GitHub
        </button>
      ) : state === "approved" ? (
        <p className="mt-5 text-sm text-emerald-600">Terminal connected. You can return to the CLI.</p>
      ) : state === "denied" ? (
        <p className="mt-5 text-sm text-red-600">Request denied.</p>
      ) : (
        <div className="mt-4 flex gap-2">
          <button className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40" disabled={state !== "ready"} onClick={() => decide("approve")}>
            Approve
          </button>
          <button className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40" disabled={state !== "ready"} onClick={() => decide("deny")}>
            Deny
          </button>
        </div>
      )}

      {state === "checking" && <p className="mt-4 text-xs text-zinc-500">Checking device code…</p>}
      {state === "error" && <p className="mt-4 text-sm text-red-600">{message}</p>}
      {session && <p className="mt-5 border-t border-zinc-100 pt-4 text-xs text-zinc-500">Signed in as {session.user.email}</p>}
    </section>
  );
}
