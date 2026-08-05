import {
  CheckoutListResponseSchema,
  CurrentUserResponseSchema,
  ProjectListResponseSchema,
  ProjectCacheMutationResponseSchema,
  ProjectCacheResponseSchema,
  ProjectResponseSchema,
  ProjectWorkspaceListResponseSchema,
  ManagedSandboxInteractiveResponseSchema,
  RunEventsResponseSchema,
  RunListResponseSchema,
  RunSocketTicketResponseSchema,
  RespondRunCapabilityResponseSchema,
  RemoteExecutionResponseSchema,
  type ManagedCheckout,
  type ManagedProject,
  type ManagedRunOperation,
  type ManagedWorkspace,
  type ManagedSandboxInteractiveResponse,
  type ManagedRun,
  type ManagedRunEvent,
  type ManagedUser,
  type ProjectCacheMutationResponse,
  type ProjectCacheResponse,
  type RemoteExecutionRequest,
  type RemoteExecutionResponse,
} from "@usestoke/managed";

export class StokeApiError extends Error {
  override name = "StokeApiError";

  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.message === "string"
      ? body.message
      : `Stoke API request failed with ${response.status}`;
    throw new StokeApiError(message, response.status, body);
  }
  return body;
}

export async function getCurrentUser(): Promise<ManagedUser | null> {
  try {
    return CurrentUserResponseSchema.parse(await request("/api/v1/auth/me")).user;
  } catch (error) {
    if (error instanceof StokeApiError && error.status === 401) return null;
    throw error;
  }
}

export async function getProjects(): Promise<ManagedProject[]> {
  return ProjectListResponseSchema.parse(await request("/api/v1/projects")).projects;
}

export async function createGitHubProject(input: { url: string }): Promise<ManagedProject> {
  const source = parseGitHubProjectUrl(input.url);
  return ProjectResponseSchema.parse(await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: source.repository, source }),
  })).project;
}

export async function deleteManagedProject(projectId: string): Promise<ManagedProject> {
  return ProjectResponseSchema.parse(await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  )).project;
}

export async function getProjectWorkspaces(projectId: string): Promise<ManagedWorkspace[]> {
  return ProjectWorkspaceListResponseSchema.parse(
    await request(`/api/v1/projects/${encodeURIComponent(projectId)}/workspaces`),
  ).workspaces;
}

export async function openWorkspaceTerminal(
  projectId: string,
  sandboxName: string,
): Promise<ManagedSandboxInteractiveResponse> {
  return ManagedSandboxInteractiveResponseSchema.parse(await request(
    `/api/v1/sandboxes/${encodeURIComponent(sandboxName)}/interactive`,
    { method: "POST", body: JSON.stringify({ projectId }) },
  ));
}

export async function executeProject(
  projectId: string,
  operation: ManagedRunOperation,
): Promise<RemoteExecutionResponse> {
  return RemoteExecutionResponseSchema.parse(await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/executions`,
    {
      method: "POST",
      body: JSON.stringify({ operation, origin: "dashboard" }),
    },
  ));
}

export async function executeProjectRequest(
  projectId: string,
  input: DashboardRemoteExecutionRequest,
): Promise<RemoteExecutionResponse> {
  return RemoteExecutionResponseSchema.parse(await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/executions`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, origin: "dashboard" }),
    },
  ));
}

type DashboardRemoteExecutionRequest = RemoteExecutionRequest extends infer Request
  ? Request extends RemoteExecutionRequest ? Omit<Request, "origin"> : never
  : never;

export async function getProjectCache(projectId: string): Promise<ProjectCacheResponse> {
  return ProjectCacheResponseSchema.parse(
    await request(`/api/v1/projects/${encodeURIComponent(projectId)}/cache`),
  );
}

export async function invalidateProjectCacheEntry(
  projectId: string,
  input: { scope: string; entryId: string },
): Promise<ProjectCacheMutationResponse> {
  return ProjectCacheMutationResponseSchema.parse(await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/cache/invalidate`,
    { method: "POST", body: JSON.stringify(input) },
  ));
}

export async function clearProjectCache(projectId: string): Promise<ProjectCacheMutationResponse> {
  return ProjectCacheMutationResponseSchema.parse(await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/cache`,
    { method: "DELETE" },
  ));
}

export async function getCheckouts(): Promise<ManagedCheckout[]> {
  return CheckoutListResponseSchema.parse(await request("/api/v1/checkouts")).checkouts;
}

export async function getRuns(): Promise<ManagedRun[]> {
  return RunListResponseSchema.parse(await request("/api/v1/runs")).runs;
}

export async function getRunEvents(runId: string): Promise<ManagedRunEvent[]> {
  return RunEventsResponseSchema.parse(
    await request(`/api/v1/runs/${encodeURIComponent(runId)}/events`),
  ).events;
}

export async function createRunTicket(runId: string): Promise<string> {
  return RunSocketTicketResponseSchema.parse(
    await request(`/api/v1/runs/${encodeURIComponent(runId)}/ticket`, { method: "POST" }),
  ).socketUrl;
}

export async function respondRunCapability(
  runId: string,
  requestId: string,
  result: Record<string, unknown>,
): Promise<ManagedRunEvent> {
  return RespondRunCapabilityResponseSchema.parse(await request(
    `/api/v1/runs/${encodeURIComponent(runId)}/capabilities/${encodeURIComponent(requestId)}/respond`,
    { method: "POST", body: JSON.stringify({ result }) },
  )).event;
}

export type DeviceAuthorizationStatus = "pending" | "approved" | "denied";

export async function getDeviceAuthorization(userCode: string): Promise<DeviceAuthorizationStatus> {
  const body = await request(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`) as {
    status?: DeviceAuthorizationStatus;
  };
  if (body.status !== "pending" && body.status !== "approved" && body.status !== "denied") {
    throw new Error("Stoke returned an invalid device authorization status");
  }
  return body.status;
}

export async function decideDeviceAuthorization(input: {
  userCode: string;
  action: "approve" | "deny";
}): Promise<void> {
  await request(`/api/auth/device/${input.action}`, {
    method: "POST",
    body: JSON.stringify({ userCode: input.userCode }),
  });
}

export function parseGitHubProjectUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete GitHub URL, such as https://github.com/vercel/next.js");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Enter a github.com repository URL");
  }
  const [owner, rawRepository, ...rest] = url.pathname.split("/").filter(Boolean);
  const repository = rawRepository?.replace(/\.git$/, "");
  if (!owner || !repository || rest.length) throw new Error("Enter a GitHub repository URL");
  return {
    kind: "github" as const,
    owner,
    repository,
    url: `https://github.com/${owner}/${repository}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
