import {
  CreateProjectRequestSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
} from "@stoke/managed";
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../../server/auth.ts";
import { createProject, listProjects } from "../../../../server/projects.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const projects = await listProjects(user.id);
    return NextResponse.json(ProjectListResponseSchema.parse({ projects }));
  } catch (error) {
    return controlPlaneError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const parsed = CreateProjectRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const project = await createProject(user.id, parsed.data);
    return NextResponse.json(ProjectResponseSchema.parse({ project }), { status: 201 });
  } catch (error) {
    return controlPlaneError(error);
  }
}

function controlPlaneError(error: unknown) {
  if (error instanceof Error && error.name === "AuthenticationError") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.name === "ControlPlaneConfigError") {
    return NextResponse.json({ error: "service_not_configured", message: error.message }, { status: 503 });
  }

  console.error(error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
