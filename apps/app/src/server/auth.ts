import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function requireApiToken(request: Request): NextResponse | undefined {
  const expected = process.env.STOKE_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "service_not_configured", message: "STOKE_API_TOKEN is not configured" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization");
  const actual = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  const valid =
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);

  if (!valid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
