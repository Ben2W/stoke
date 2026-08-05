"use client";

import { Suspense } from "react";
import { DeviceAuthorization } from "./device-authorization.tsx";

export default function DevicePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-5 py-12 text-zinc-950">
      <Suspense fallback={<section className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">Loading authorization request…</section>}>
        <DeviceAuthorization />
      </Suspense>
    </main>
  );
}
