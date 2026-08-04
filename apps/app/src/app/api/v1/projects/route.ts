import {
  CreateProjectRequestSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
} from "@stoke/managed";
import { NextResponse } from "next/server";
import { requireApiToken } from "../../../../server/auth.ts";
import { createProject, listProjects } from "../../../../server/projects.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  try {
    const projects = await listProjects();
    return NextResponse.json(ProjectListResponseSchema.parse({ projects }));
  } catch (error) {
    return controlPlaneError(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = requireApiToken(request);
  if (unauthorized) return unauthorized;

  const parsed = CreateProjectRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const project = await createProject(parsed.data);
    return NextResponse.json(ProjectResponseSchema.parse({ project }), { status: 201 });
  } catch (error) {
    return controlPlaneError(error);
  }
}

function controlPlaneError(error: unknown) {
  if (error instanceof Error && error.name === "ControlPlaneConfigError") {
    return NextResponse.json({ error: "service_not_configured", message: error.message }, { status: 503 });
  }

  console.error(error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
