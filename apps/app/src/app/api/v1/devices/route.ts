import { DeviceResponseSchema, RegisterDeviceRequestSchema } from "@stoke/managed";
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../../server/auth.ts";
import { registerDevice } from "../../../../server/devices.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const parsed = RegisterDeviceRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
    }
    const device = await registerDevice(user.id, parsed.data);
    return NextResponse.json(DeviceResponseSchema.parse({ device }));
  } catch (error) {
    return apiError(error);
  }
}

function apiError(error: unknown) {
  if (error instanceof Error && error.name === "AuthenticationError") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.name === "ManagedResourceConflictError") {
    return NextResponse.json({ error: "conflict", message: error.message }, { status: 409 });
  }
  console.error(error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
