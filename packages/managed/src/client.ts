import {
  type CreateProjectRequest,
  type ManagedProject,
  type ManagedUser,
  CreateProjectRequestSchema,
  CurrentUserResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
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
  };
}
