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
  type ManagedRun,
  type ManagedRunEvent,
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
  RunEventsResponseSchema,
  RunListResponseSchema,
  RunResponseSchema,
  RunSocketTicketResponseSchema,
} from "./contracts.ts";

export type ManagedClientOptions = {
  baseUrl: string;
  token: string;
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
  registerDevice(input: RegisterDeviceRequest): Promise<ManagedDevice>;
  listCheckouts(deviceId?: string): Promise<ManagedCheckout[]>;
  registerCheckout(input: RegisterCheckoutRequest): Promise<ManagedCheckout>;
  claimRun(input: ClaimRunRequest): Promise<ClaimRunResponse>;
  listRuns(projectId?: string): Promise<ManagedRun[]>;
  getRun(runId: string): Promise<ManagedRun>;
  listRunEvents(runId: string, after?: number): Promise<ManagedRunEvent[]>;
  createRunSocketTicket(runId: string, role?: "viewer" | "producer"): Promise<string>;
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

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchImplementation(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new ManagedApiError(`Stoke API request failed with ${response.status}`, response.status, body);
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
    async createRunSocketTicket(runId, role = "viewer") {
      return RunSocketTicketResponseSchema.parse(
        await request(`/api/v1/runs/${encodeURIComponent(runId)}/ticket?role=${role}`, { method: "POST" }),
      ).socketUrl;
    },
  };
}
