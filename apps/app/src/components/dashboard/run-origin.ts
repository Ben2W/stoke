import type { ManagedRun } from "@usestoke/managed";

export function runOriginLabel(run: ManagedRun): string {
  if (run.origin === "dashboard") return "Stoke dashboard · Vercel Sandbox";
  if (run.origin === "cli") return "Stoke CLI · Vercel Sandbox";
  return run.deviceName ?? "Local checkout";
}
