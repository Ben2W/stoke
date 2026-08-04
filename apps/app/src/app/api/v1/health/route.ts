import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "stoke-control-plane",
    apiVersion: 1,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
}
