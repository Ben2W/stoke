import {
  CheckoutListResponseSchema,
  CheckoutResponseSchema,
  ClaimRunRequestSchema,
  ClaimRunResponseSchema,
  CreateManagedSandboxRequestSchema,
  CreateManagedSandboxSnapshotRequestSchema,
  CreateProjectRequestSchema,
  DeviceResponseSchema,
  InvalidateProjectCacheRequestSchema,
  ManagedSandboxCommandResponseSchema,
  ManagedSandboxInteractiveResponseSchema,
  ManagedSandboxResponseSchema,
  ManagedSandboxSnapshotResponseSchema,
  OpenManagedSandboxInteractiveRequestSchema,
  ProjectCacheMutationResponseSchema,
  ProjectCacheResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  RegisterCheckoutRequestSchema,
  RegisterDeviceRequestSchema,
  RemoteExecutionRequestSchema,
  RemoteExecutionResponseSchema,
  ProjectStateResponseSchema,
  ProjectWorkspaceListResponseSchema,
  UpdateProjectStateRequestSchema,
  RunEventsResponseSchema,
  RunManagedSandboxCommandRequestSchema,
  RunListResponseSchema,
  RunResponseSchema,
  RunSocketTicketResponseSchema,
  RespondRunCapabilityRequestSchema,
  RespondRunCapabilityResponseSchema,
} from "@usestoke/managed";
import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";
import { authenticateRequest } from "./auth.ts";
import { listCheckouts, registerCheckout, registerDevice } from "./devices.ts";
import { PublicGitHubRepositoryRequiredError } from "./github-repository.ts";
import { createProject, deleteProject, listProjects, verifyProjectSource } from "./projects.ts";
import {
  createManagedSandbox,
  openManagedSandboxInteractive,
  runManagedSandboxCommand,
  snapshotManagedSandbox,
  stopManagedSandbox,
} from "./managed-sandboxes.ts";
import { clearProjectCache, invalidateProjectCache, listProjectCache } from "./project-cache.ts";
import { getProjectState, ProjectStateConflictError, updateProjectState } from "./project-state.ts";
import { listProjectWorkspaces } from "./project-workspaces.ts";
import {
  executeRemoteProject,
  RemoteExecutionError,
  startRemoteProjectExecution,
  WorkspaceRevisionRequiredError,
} from "./remote-executions.ts";
import { createRunSocketUrl } from "./run-tickets.ts";
import { respondToRunCapability } from "./run-capabilities.ts";
import { claimRun, getRun, listRunEvents, listRuns } from "./runs.ts";

type AuthenticatedUser = Awaited<ReturnType<typeof authenticateRequest>>;

type ApiDependencies = {
  authenticate: typeof authenticateRequest;
  createProject: typeof createProject;
  deleteProject: typeof deleteProject;
  verifyProjectSource: typeof verifyProjectSource;
  listProjects: typeof listProjects;
  listCheckouts: typeof listCheckouts;
  registerCheckout: typeof registerCheckout;
  registerDevice: typeof registerDevice;
  claimRun: typeof claimRun;
  getRun: typeof getRun;
  listRunEvents: typeof listRunEvents;
  listRuns: typeof listRuns;
  respondToRunCapability: typeof respondToRunCapability;
  executeRemoteProject: typeof executeRemoteProject;
  startRemoteProjectExecution: typeof startRemoteProjectExecution;
  getProjectState: typeof getProjectState;
  updateProjectState: typeof updateProjectState;
  listProjectWorkspaces: typeof listProjectWorkspaces;
  listProjectCache: typeof listProjectCache;
  invalidateProjectCache: typeof invalidateProjectCache;
  clearProjectCache: typeof clearProjectCache;
  createManagedSandbox: typeof createManagedSandbox;
  runManagedSandboxCommand: typeof runManagedSandboxCommand;
  snapshotManagedSandbox: typeof snapshotManagedSandbox;
  stopManagedSandbox: typeof stopManagedSandbox;
  openManagedSandboxInteractive: typeof openManagedSandboxInteractive;
};

const defaultDependencies: ApiDependencies = {
  authenticate: authenticateRequest,
  createProject,
  deleteProject,
  verifyProjectSource,
  listProjects,
  listCheckouts,
  registerCheckout,
  registerDevice,
  claimRun,
  getRun,
  listRunEvents,
  listRuns,
  respondToRunCapability,
  executeRemoteProject,
  startRemoteProjectExecution,
  getProjectState,
  updateProjectState,
  listProjectWorkspaces,
  listProjectCache,
  invalidateProjectCache,
  clearProjectCache,
  createManagedSandbox,
  runManagedSandboxCommand,
  snapshotManagedSandbox,
  stopManagedSandbox,
  openManagedSandboxInteractive,
};

export function createApi(overrides: Partial<ApiDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const api = new Hono().basePath("/api/v1");

  api.get("/health", (context) => context.json({
    status: "ok",
    service: "stoke-control-plane",
    apiVersion: 1,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    githubAuthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  }));

  const managed = new Hono<{ Variables: { user: AuthenticatedUser } }>();
  managed.use("*", async (context, next) => {
    const user = await dependencies.authenticate(context.req.raw);
    if ("sandboxProjectId" in user && !context.req.path.startsWith("/api/v1/sandboxes")) {
      return context.json({ error: "forbidden", message: "Sandbox credentials can only manage Vercel Sandboxes" }, 403);
    }
    context.set("user", user);
    await next();
  });

  managed.get("/auth/me", (context) => {
    const user = context.get("user");
    return context.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    });
  });

  managed.get("/projects", async (context) => {
    const projects = await dependencies.listProjects(context.get("user").id);
    return context.json(ProjectListResponseSchema.parse({ projects }));
  });

  managed.post("/projects", async (context) => {
    const parsed = CreateProjectRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const project = await dependencies.createProject(context.get("user").id, parsed.data);
    return context.json(ProjectResponseSchema.parse({ project }), 201);
  });

  managed.delete("/projects/:projectId", async (context) => {
    const project = await dependencies.deleteProject(
      context.get("user").id,
      context.req.param("projectId"),
    );
    if (!project) return context.json({ error: "not_found" }, 404);
    return context.json(ProjectResponseSchema.parse({ project }));
  });

  managed.post("/projects/:projectId/verify-source", async (context) => {
    const project = await dependencies.verifyProjectSource(
      context.get("user").id,
      context.req.param("projectId"),
    );
    if (!project) return context.json({ error: "not_found" }, 404);
    return context.json(ProjectResponseSchema.parse({ project }));
  });

  managed.post("/projects/:projectId/executions", async (context) => {
    const parsed = RemoteExecutionRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const userId = context.get("user").id;
    const projectId = context.req.param("projectId");
    if (parsed.data.origin === "dashboard") {
      const started = await dependencies.startRemoteProjectExecution(userId, projectId, parsed.data);
      if (started.completion) {
        waitUntil(started.completion.catch((error) => {
          console.error("Background remote execution failed", error);
        }));
      }
      return context.json(RemoteExecutionResponseSchema.parse({
        run: started.run,
        disposition: started.disposition,
      }), 202);
    }
    const executed = await dependencies.executeRemoteProject(userId, projectId, parsed.data);
    return context.json(RemoteExecutionResponseSchema.parse(executed));
  });

  managed.get("/projects/:projectId/workspaces", async (context) => {
    const workspaces = await dependencies.listProjectWorkspaces(
      context.get("user").id,
      context.req.param("projectId"),
    );
    return context.json(ProjectWorkspaceListResponseSchema.parse({ workspaces }));
  });

  managed.get("/projects/:projectId/cache", async (context) => {
    const cache = await dependencies.listProjectCache(
      context.get("user").id,
      context.req.param("projectId"),
    );
    return context.json(ProjectCacheResponseSchema.parse(cache));
  });

  managed.post("/projects/:projectId/cache/invalidate", async (context) => {
    const parsed = InvalidateProjectCacheRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const result = await dependencies.invalidateProjectCache(
      context.get("user").id,
      context.req.param("projectId"),
      parsed.data,
    );
    return context.json(ProjectCacheMutationResponseSchema.parse(result));
  });

  managed.delete("/projects/:projectId/cache", async (context) => {
    const result = await dependencies.clearProjectCache(
      context.get("user").id,
      context.req.param("projectId"),
    );
    return context.json(ProjectCacheMutationResponseSchema.parse(result));
  });

  managed.get("/projects/:projectId/state", async (context) => {
    const state = await dependencies.getProjectState(
      context.get("user").id,
      context.req.param("projectId"),
    );
    return context.json(ProjectStateResponseSchema.parse(state));
  });

  managed.put("/projects/:projectId/state", async (context) => {
    const parsed = UpdateProjectStateRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const state = await dependencies.updateProjectState(
      context.get("user").id,
      context.req.param("projectId"),
      parsed.data,
    );
    return context.json(ProjectStateResponseSchema.parse(state));
  });

  managed.post("/devices", async (context) => {
    const parsed = RegisterDeviceRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const device = await dependencies.registerDevice(context.get("user").id, parsed.data);
    return context.json(DeviceResponseSchema.parse({ device }));
  });

  managed.get("/checkouts", async (context) => {
    const checkouts = await dependencies.listCheckouts(
      context.get("user").id,
      context.req.query("deviceId"),
    );
    return context.json(CheckoutListResponseSchema.parse({ checkouts }));
  });

  managed.post("/checkouts", async (context) => {
    const parsed = RegisterCheckoutRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const checkout = await dependencies.registerCheckout(context.get("user").id, parsed.data);
    return context.json(CheckoutResponseSchema.parse({ checkout }));
  });

  managed.post("/sandboxes", async (context) => {
    const parsed = CreateManagedSandboxRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    if (sandboxProjectId(context.get("user")) && sandboxProjectId(context.get("user")) !== parsed.data.projectId) {
      return context.json({ error: "forbidden" }, 403);
    }
    const sandbox = await dependencies.createManagedSandbox(context.get("user").id, parsed.data);
    return context.json(ManagedSandboxResponseSchema.parse({ sandbox }), 201);
  });

  managed.post("/sandboxes/:sandboxName/commands", async (context) => {
    const parsed = RunManagedSandboxCommandRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    if (sandboxProjectId(context.get("user")) && sandboxProjectId(context.get("user")) !== parsed.data.projectId) {
      return context.json({ error: "forbidden" }, 403);
    }
    const result = await dependencies.runManagedSandboxCommand(
      context.get("user").id,
      context.req.param("sandboxName"),
      parsed.data,
    );
    return context.json(ManagedSandboxCommandResponseSchema.parse(result));
  });

  managed.post("/sandboxes/:sandboxName/snapshots", async (context) => {
    const parsed = CreateManagedSandboxSnapshotRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    if (sandboxProjectId(context.get("user")) && sandboxProjectId(context.get("user")) !== parsed.data.projectId) {
      return context.json({ error: "forbidden" }, 403);
    }
    const snapshot = await dependencies.snapshotManagedSandbox(
      context.get("user").id,
      context.req.param("sandboxName"),
      parsed.data,
    );
    return context.json(ManagedSandboxSnapshotResponseSchema.parse({ snapshot }), 201);
  });

  managed.delete("/sandboxes/:sandboxName", async (context) => {
    const projectId = context.req.query("projectId");
    if (!projectId) {
      return context.json({ error: "invalid_request", message: "projectId is required" }, 400);
    }
    if (sandboxProjectId(context.get("user")) && sandboxProjectId(context.get("user")) !== projectId) {
      return context.json({ error: "forbidden" }, 403);
    }
    await dependencies.stopManagedSandbox(
      context.get("user").id,
      context.req.param("sandboxName"),
      projectId,
    );
    return context.json({ ok: true });
  });

  managed.post("/sandboxes/:sandboxName/interactive", async (context) => {
    const parsed = OpenManagedSandboxInteractiveRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    if (sandboxProjectId(context.get("user")) && sandboxProjectId(context.get("user")) !== parsed.data.projectId) {
      return context.json({ error: "forbidden" }, 403);
    }
    const interactive = await dependencies.openManagedSandboxInteractive(
      context.get("user").id,
      context.req.param("sandboxName"),
      parsed.data.projectId,
    );
    return context.json(ManagedSandboxInteractiveResponseSchema.parse(interactive));
  });

  managed.post("/runs/claim", async (context) => {
    const parsed = ClaimRunRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const user = context.get("user");
    const claimed = await dependencies.claimRun(user.id, parsed.data);
    return context.json(ClaimRunResponseSchema.parse({
      ...claimed,
      socketUrl: createRunSocketUrl(context.req.url, {
        runId: claimed.run.id,
        userId: user.id,
        role: claimed.disposition === "created" ? "producer" : "viewer",
      }),
    }), claimed.disposition === "created" ? 201 : 200);
  });

  managed.get("/runs", async (context) => {
    const runs = await dependencies.listRuns(context.get("user").id, context.req.query("projectId"));
    return context.json(RunListResponseSchema.parse({ runs }));
  });

  managed.get("/runs/:runId", async (context) => {
    const run = await dependencies.getRun(context.get("user").id, context.req.param("runId"));
    return context.json(RunResponseSchema.parse({ run }));
  });

  managed.get("/runs/:runId/events", async (context) => {
    const after = Number(context.req.query("after") ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      return context.json({ error: "invalid_request", message: "after must be a non-negative integer" }, 400);
    }
    const events = await dependencies.listRunEvents(
      context.get("user").id,
      context.req.param("runId"),
      after,
    );
    return context.json(RunEventsResponseSchema.parse({ events }));
  });

  managed.post("/runs/:runId/capabilities/:requestId/respond", async (context) => {
    const parsed = RespondRunCapabilityRequestSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      return context.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }
    const event = await dependencies.respondToRunCapability(
      context.get("user").id,
      context.req.param("runId"),
      context.req.param("requestId"),
      parsed.data,
    );
    return context.json(RespondRunCapabilityResponseSchema.parse({ event }));
  });

  managed.post("/runs/:runId/ticket", async (context) => {
    const user = context.get("user");
    const run = await dependencies.getRun(user.id, context.req.param("runId"));
    const role = context.req.query("role") ?? "viewer";
    if (role !== "viewer" && role !== "producer") {
      return context.json({ error: "invalid_request", message: "role must be viewer or producer" }, 400);
    }
    return context.json(RunSocketTicketResponseSchema.parse({
      socketUrl: createRunSocketUrl(context.req.url, {
        runId: run.id,
        userId: user.id,
        role,
      }),
    }));
  });

  api.route("/", managed);
  api.notFound((context) => context.json({ error: "not_found" }, 404));
  api.onError((error, context) => {
    if (error.name === "AuthenticationError") {
      return context.json({ error: "unauthorized" }, 401);
    }
    if (error.name === "ManagedResourceConflictError") {
      const details = "details" in error ? error.details : undefined;
      return context.json({ error: "conflict", message: error.message, details }, 409);
    }
    if (error.name === "ControlPlaneConfigError") {
      return context.json({ error: "service_not_configured", message: error.message }, 503);
    }
    if (error instanceof RemoteExecutionError) {
      return context.json({ error: "remote_execution_failed", message: error.message, run: error.run }, 422);
    }
    if (error instanceof WorkspaceRevisionRequiredError) {
      return context.json({ error: "workspace_revision_required", message: error.message }, 409);
    }
    if (error instanceof PublicGitHubRepositoryRequiredError) {
      return context.json({ error: "public_github_repository_required", message: error.message }, 422);
    }
    if (error instanceof ProjectStateConflictError) {
      return context.json({
        error: "state_conflict",
        message: error.message,
        currentRevision: error.currentRevision,
      }, 409);
    }
    if (error.message.includes("not found")) {
      return context.json({ error: "not_found", message: error.message }, 404);
    }
    console.error(error);
    return context.json({ error: "internal_error" }, 500);
  });

  return api;
}

async function readJson(request: Request): Promise<unknown> {
  return await request.json().catch(() => null);
}

function sandboxProjectId(user: AuthenticatedUser): string | undefined {
  return "sandboxProjectId" in user ? user.sandboxProjectId : undefined;
}

export const api = createApi();
