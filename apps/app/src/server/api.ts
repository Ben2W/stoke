import {
  CheckoutListResponseSchema,
  CheckoutResponseSchema,
  CreateProjectRequestSchema,
  DeviceResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  RegisterCheckoutRequestSchema,
  RegisterDeviceRequestSchema,
} from "@stoke/managed";
import { Hono } from "hono";
import { authenticateRequest } from "./auth.ts";
import { listCheckouts, registerCheckout, registerDevice } from "./devices.ts";
import { createProject, listProjects } from "./projects.ts";

type AuthenticatedUser = Awaited<ReturnType<typeof authenticateRequest>>;

type ApiDependencies = {
  authenticate: typeof authenticateRequest;
  createProject: typeof createProject;
  listProjects: typeof listProjects;
  listCheckouts: typeof listCheckouts;
  registerCheckout: typeof registerCheckout;
  registerDevice: typeof registerDevice;
};

const defaultDependencies: ApiDependencies = {
  authenticate: authenticateRequest,
  createProject,
  listProjects,
  listCheckouts,
  registerCheckout,
  registerDevice,
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
    context.set("user", await dependencies.authenticate(context.req.raw));
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

export const api = createApi();
