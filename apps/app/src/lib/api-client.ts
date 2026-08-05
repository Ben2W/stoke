import {
  CheckoutListResponseSchema,
  CurrentUserResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  ProjectWorkspaceListResponseSchema,
  RunEventsResponseSchema,
  RunListResponseSchema,
  RunSocketTicketResponseSchema,
  type ManagedCheckout,
  type ManagedProject,
  type ManagedWorkspace,
  type ManagedRun,
  type ManagedRunEvent,
  type ManagedUser,
} from "@stoke/managed";

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
    throw new StokeApiError(`Stoke API request failed with ${response.status}`, response.status, body);
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

export async function getProjectWorkspaces(projectId: string): Promise<ManagedWorkspace[]> {
  return ProjectWorkspaceListResponseSchema.parse(
    await request(`/api/v1/projects/${encodeURIComponent(projectId)}/workspaces`),
  ).workspaces;
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
