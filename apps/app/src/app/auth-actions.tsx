"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client.ts";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      className="button button-primary"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({ provider: "github", callbackURL: "/" });
      }}
      type="button"
    >
      {pending ? "Opening GitHub…" : "Sign in with GitHub"}
      <span aria-hidden="true">↗</span>
    </button>
  );
}

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      className="text-button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut({
          fetchOptions: {
            onSuccess: () => window.location.assign("/"),
          },
        });
      }}
      type="button"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
