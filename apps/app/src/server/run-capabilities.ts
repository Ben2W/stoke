import type { ManagedRunEvent, RespondRunCapabilityRequest } from "@usestoke/managed";
import { appendRunEvent, getRun, listRunEvents } from "./runs.ts";

type RunCapabilityDependencies = {
  getRun: typeof getRun;
  listRunEvents: typeof listRunEvents;
  appendRunEvent: typeof appendRunEvent;
};

const defaultDependencies: RunCapabilityDependencies = {
  getRun,
  listRunEvents,
  appendRunEvent,
};

export async function respondToRunCapability(
  userId: string,
  runId: string,
  requestId: string,
  input: RespondRunCapabilityRequest,
  overrides: Partial<RunCapabilityDependencies> = {},
): Promise<ManagedRunEvent> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const run = await dependencies.getRun(userId, runId);
  if (run.status !== "running") throw new Error("Managed run is no longer active");
  if (run.origin !== "dashboard") throw new Error("Only dashboard runs accept capability responses");

  const events = await dependencies.listRunEvents(userId, runId);
  const existing = events.find((event) =>
    event.data.type === "host.capability.response"
    && event.data.requestId === requestId
  );
  if (existing) return existing;

  const request = events.find((event) =>
    event.data.type === "host.capability.request"
    && (event.data.id === requestId || event.data.requestId === requestId)
  );
  if (!request || typeof request.data.capability !== "string") {
    throw new Error("Host capability request was not found");
  }

  return await dependencies.appendRunEvent(userId, runId, {
    type: "host.capability.response",
    requestId,
    capability: request.data.capability,
    result: validateCapabilityResult(request.data.capability, input.result),
  });
}

function validateCapabilityResult(
  capability: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  if (capability === "browser.open" && result.opened !== true) {
    throw new Error("browser.open must be acknowledged with opened: true");
  }
  return result;
}
