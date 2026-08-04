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

  if (isPending) return <section className="panel">Loading authorization request…</section>;

  return (
    <section className="panel">
      <div className="eyebrow">Stoke CLI authorization</div>
      <h1 className="panel-title">Connect this terminal?</h1>
      <p className="panel-copy">
        Confirm the code shown by <code>stoke login</code>. Only approve terminals you recognize.
      </p>

      <label className="code-label" htmlFor="device-code">Device code</label>
      <input
        id="device-code"
        className="code-input"
        value={userCode}
        onChange={(event) => {
          setUserCode(event.target.value.toUpperCase());
          setState("idle");
        }}
        placeholder="ABCD-EFGH"
        autoComplete="one-time-code"
      />

      {!session ? (
        <button className="primary-button" disabled={!userCode} onClick={signIn}>
          Sign in with GitHub
        </button>
      ) : state === "approved" ? (
        <p className="success-message">Terminal connected. You can return to the CLI.</p>
      ) : state === "denied" ? (
        <p className="error-message">Request denied.</p>
      ) : (
        <div className="button-row">
          <button className="primary-button" disabled={state !== "ready"} onClick={() => decide("approve")}>
            Approve
          </button>
          <button className="secondary-button" disabled={state !== "ready"} onClick={() => decide("deny")}>
            Deny
          </button>
        </div>
      )}

      {state === "checking" && <p className="helper-message">Checking device code…</p>}
      {state === "error" && <p className="error-message">{message}</p>}
      {session && <p className="helper-message">Signed in as {session.user.email}</p>}
    </section>
  );
}
