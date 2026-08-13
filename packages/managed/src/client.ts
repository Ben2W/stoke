import {
  type CreateProjectRequest,
  type ManagedProject,
  type ManagedCheckout,
  type ManagedDevice,
  type ManagedUser,
  type RegisterCheckoutRequest,
  type RegisterDeviceRequest,
  type ClaimRunRequest,
  type ClaimRunResponse,
  type AppendRunEventRequest,
  type ManagedRun,
  type ManagedRunEvent,
  type RespondRunCapabilityRequest,
  type RemoteExecutionRequest,
  type RemoteExecutionResponse,
  type ManagedProjectStateSnapshot,
  type CreateManagedSandboxRequest,
  type CreateManagedSandboxSnapshotRequest,
  type ManagedSandbox,
  type ManagedSandboxSnapshot,
  type RunManagedSandboxCommandRequest,
  type ManagedSandboxCommandResponse,
  type ProjectStateResponse,
  CheckoutListResponseSchema,
  CheckoutResponseSchema,
  CreateProjectRequestSchema,
  CurrentUserResponseSchema,
  DeviceResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  RegisterCheckoutRequestSchema,
  RegisterDeviceRequestSchema,
  ClaimRunRequestSchema,
  ClaimRunResponseSchema,
  AppendRunEventRequestSchema,
  AppendRunEventResponseSchema,
  HeartbeatRunResponseSchema,
  RunEventsResponseSchema,
  RunListResponseSchema,
  RunResponseSchema,
  RespondRunCapabilityRequestSchema,
  RespondRunCapabilityResponseSchema,
  RemoteExecutionRequestSchema,
  RemoteExecutionResponseSchema,
  ProjectStateResponseSchema,
  UpdateProjectStateRequestSchema,
  CreateManagedSandboxRequestSchema,
  CreateManagedSandboxSnapshotRequestSchema,
  ManagedSandboxResponseSchema,
  ManagedSandboxSnapshotResponseSchema,
  RunManagedSandboxCommandRequestSchema,
  ManagedSandboxCommandResponseSchema,
  ManagedSandboxInteractiveResponseSchema,
  OpenManagedSandboxInteractiveRequestSchema,
} from "./contracts.ts";

export type ManagedClientOptions = {
  baseUrl: string;
  token: string | (() => string | undefined);
  onUnauthorized?: () => Promise<string | undefined>;
  fetch?: ManagedFetch;
};

export type ManagedFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ManagedClient = {
  currentUser(): Promise<ManagedUser>;
  listProjects(): Promise<ManagedProject[]>;
  createProject(input: CreateProjectRequest): Promise<ManagedProject>;
  verifyProjectSource(projectId: string): Promise<ManagedProject>;
  deleteProject(projectId: string): Promise<ManagedProject>;
  registerDevice(input: RegisterDeviceRequest): Promise<ManagedDevice>;
  listCheckouts(deviceId?: string): Promise<ManagedCheckout[]>;
  registerCheckout(input: RegisterCheckoutRequest): Promise<ManagedCheckout>;
  claimRun(input: ClaimRunRequest): Promise<ClaimRunResponse>;
  listRuns(projectId?: string): Promise<ManagedRun[]>;
  getRun(runId: string): Promise<ManagedRun>;
  listRunEvents(runId: string, after?: number): Promise<ManagedRunEvent[]>;
  appendRunEvent(runId: string, input: AppendRunEventRequest): Promise<ManagedRunEvent>;
  heartbeatRun(runId: string): Promise<void>;
  respondRunCapability(
    runId: string,
    requestId: string,
    input: RespondRunCapabilityRequest,
  ): Promise<ManagedRunEvent>;
  executeProject(projectId: string, input: RemoteExecutionRequest): Promise<RemoteExecutionResponse>;
  getProjectState(projectId: string): Promise<ProjectStateResponse>;
  updateProjectState(
    projectId: string,
    expectedRevision: number,
    snapshot: ManagedProjectStateSnapshot,
  ): Promise<ProjectStateResponse>;
  createSandbox(input: CreateManagedSandboxRequest): Promise<ManagedSandbox>;
  snapshotSandbox(
    sandboxName: string,
    input: CreateManagedSandboxSnapshotRequest,
  ): Promise<ManagedSandboxSnapshot>;
  runSandboxCommand(
    sandboxName: string,
    input: RunManagedSandboxCommandRequest,
  ): Promise<ManagedSandboxCommandResponse>;
  stopSandbox(sandboxName: string, projectId: string): Promise<void>;
  openSandboxInteractive(sandboxName: string, projectId: string): Promise<{
    url: string;
    token: string;
  }>;
};

export class ManagedApiError extends Error {
  override name = "ManagedApiError";

  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export function createManagedClient(options: ManagedClientOptions): ManagedClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  let authentication: Promise<string | undefined> | undefined;

  function currentToken(): string | undefined {
    return typeof options.token === "function" ? options.token() : options.token;
  }

  async function authenticate(): Promise<string | undefined> {
    if (!options.onUnauthorized) return undefined;
    authentication ??= options.onUnauthorized().finally(() => {
      authentication = undefined;
    });
    return await authentication;
  }

  async function send(path: string, init: RequestInit | undefined, token: string): Promise<Response> {
    return await fetchImplementation(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  }

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let token = currentToken();
    if (!token) token = await authenticate();
    if (!token) throw new ManagedApiError("Stoke authentication is required", 401, undefined);

    let response = await send(path, init, token);
    if (response.status === 401 && options.onUnauthorized) {
      const refreshed = currentToken();
      token = refreshed && refreshed !== token ? refreshed : await authenticate();
      if (token) response = await send(path, init, token);
    }

    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
        ? body.message
        : `Stoke API request failed with ${response.status}`;
      throw new ManagedApiError(message, response.status, body);
    }
    return body;
  }

  return {
    async currentUser() {
      const response = CurrentUserResponseSchema.parse(await request("/api/v1/auth/me"));
      return response.user;
    },
    async listProjects() {
      const response = ProjectListResponseSchema.parse(await request("/api/v1/projects"));
      return response.projects;
    },
    async createProject(input) {
      const payload = CreateProjectRequestSchema.parse(input);
      const response = ProjectResponseSchema.parse(
        await request("/api/v1/projects", { method: "POST", body: JSON.stringify(payload) }),
      );
      return response.project;
    },
    async verifyProjectSource(projectId) {
      const response = ProjectResponseSchema.parse(
        await request(`/api/v1/projects/${encodeURIComponent(projectId)}/verify-source`, { method: "POST" }),
      );
      return response.project;
    },
    async deleteProject(projectId) {
      const response = ProjectResponseSchema.parse(
        await request(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
      );
      return response.project;
    },
    async registerDevice(input) {
      const payload = RegisterDeviceRequestSchema.parse(input);
      const response = DeviceResponseSchema.parse(
        await request("/api/v1/devices", { method: "POST", body: JSON.stringify(payload) }),
      );
      return response.device;
    },
    async listCheckouts(deviceId) {
      const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
      const response = CheckoutListResponseSchema.parse(await request(`/api/v1/checkouts${query}`));
      return response.checkouts;
    },
    async registerCheckout(input) {
      const payload = RegisterCheckoutRequestSchema.parse(input);
      const response = CheckoutResponseSchema.parse(
        await request("/api/v1/checkouts", { method: "POST", body: JSON.stringify(payload) }),
      );
      return response.checkout;
    },
    async claimRun(input) {
      const payload = ClaimRunRequestSchema.parse(input);
      return ClaimRunResponseSchema.parse(
        await request("/api/v1/runs/claim", { method: "POST", body: JSON.stringify(payload) }),
      );
    },
    async listRuns(projectId) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return RunListResponseSchema.parse(await request(`/api/v1/runs${query}`)).runs;
    },
    async getRun(runId) {
      return RunResponseSchema.parse(await request(`/api/v1/runs/${encodeURIComponent(runId)}`)).run;
    },
    async listRunEvents(runId, after) {
      const query = after ? `?after=${after}` : "";
      return RunEventsResponseSchema.parse(
        await request(`/api/v1/runs/${encodeURIComponent(runId)}/events${query}`),
      ).events;
    },
    async appendRunEvent(runId, input) {
      const payload = AppendRunEventRequestSchema.parse(input);
      return AppendRunEventResponseSchema.parse(await request(
        `/api/v1/runs/${encodeURIComponent(runId)}/events`,
        { method: "POST", body: JSON.stringify(payload) },
      )).event;
    },
    async heartbeatRun(runId) {
      HeartbeatRunResponseSchema.parse(await request(
        `/api/v1/runs/${encodeURIComponent(runId)}/heartbeat`,
        { method: "POST" },
      ));
    },
    async respondRunCapability(runId, requestId, input) {
      const payload = RespondRunCapabilityRequestSchema.parse(input);
      return RespondRunCapabilityResponseSchema.parse(
        await request(
          `/api/v1/runs/${encodeURIComponent(runId)}/capabilities/${encodeURIComponent(requestId)}/respond`,
          { method: "POST", body: JSON.stringify(payload) },
        ),
      ).event;
    },
    async executeProject(projectId, input) {
      const payload = RemoteExecutionRequestSchema.parse(input);
      return RemoteExecutionResponseSchema.parse(
        await request(`/api/v1/projects/${encodeURIComponent(projectId)}/executions`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
    },
    async getProjectState(projectId) {
      return ProjectStateResponseSchema.parse(
        await request(`/api/v1/projects/${encodeURIComponent(projectId)}/state`),
      );
    },
    async updateProjectState(projectId, expectedRevision, snapshot) {
      const payload = UpdateProjectStateRequestSchema.parse({ expectedRevision, snapshot });
      return ProjectStateResponseSchema.parse(
        await request(`/api/v1/projects/${encodeURIComponent(projectId)}/state`, {
          method: "PUT",
          body: JSON.stringify(payload),
        }),
      );
    },
    async createSandbox(input) {
      const payload = CreateManagedSandboxRequestSchema.parse(input);
      return ManagedSandboxResponseSchema.parse(
        await request("/api/v1/sandboxes", { method: "POST", body: JSON.stringify(payload) }),
      ).sandbox;
    },
    async snapshotSandbox(sandboxName, input) {
      const payload = CreateManagedSandboxSnapshotRequestSchema.parse(input);
      return ManagedSandboxSnapshotResponseSchema.parse(
        await request(`/api/v1/sandboxes/${encodeURIComponent(sandboxName)}/snapshots`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      ).snapshot;
    },
    async runSandboxCommand(sandboxName, input) {
      const payload = RunManagedSandboxCommandRequestSchema.parse(input);
      return ManagedSandboxCommandResponseSchema.parse(
        await request(`/api/v1/sandboxes/${encodeURIComponent(sandboxName)}/commands`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
    },
    async stopSandbox(sandboxName, projectId) {
      await request(
        `/api/v1/sandboxes/${encodeURIComponent(sandboxName)}?projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
    },
    async openSandboxInteractive(sandboxName, projectId) {
      const payload = OpenManagedSandboxInteractiveRequestSchema.parse({ projectId });
      return ManagedSandboxInteractiveResponseSchema.parse(
        await request(`/api/v1/sandboxes/${encodeURIComponent(sandboxName)}/interactive`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
    },
  };
}
