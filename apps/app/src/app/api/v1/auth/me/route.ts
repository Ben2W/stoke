import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../../../server/auth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AuthenticationError") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    console.error(error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
