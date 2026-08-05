import {
  CheckoutListResponseSchema,
  CheckoutResponseSchema,
  RegisterCheckoutRequestSchema,
} from "@stoke/managed";
import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../../server/auth.ts";
import { listCheckouts, registerCheckout } from "../../../../server/devices.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const deviceId = new URL(request.url).searchParams.get("deviceId") ?? undefined;
    const checkouts = await listCheckouts(user.id, deviceId);
    return NextResponse.json(CheckoutListResponseSchema.parse({ checkouts }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const parsed = RegisterCheckoutRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
    }
    const checkout = await registerCheckout(user.id, parsed.data);
    return NextResponse.json(CheckoutResponseSchema.parse({ checkout }));
  } catch (error) {
    return apiError(error);
  }
}

function apiError(error: unknown) {
  if (error instanceof Error && error.name === "AuthenticationError") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.name === "ManagedResourceConflictError") {
    const details = "details" in error ? error.details : undefined;
    return NextResponse.json({ error: "conflict", message: error.message, details }, { status: 409 });
  }
  if (error instanceof Error && error.message.includes("not found")) {
    return NextResponse.json({ error: "not_found", message: error.message }, { status: 404 });
  }
  console.error(error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
