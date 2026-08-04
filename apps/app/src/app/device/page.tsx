import { Suspense } from "react";
import { DeviceAuthorization } from "./device-authorization.tsx";

export default function DevicePage() {
  return (
    <main>
      <Suspense fallback={<section className="panel">Loading authorization request…</section>}>
        <DeviceAuthorization />
      </Suspense>
    </main>
  );
}
