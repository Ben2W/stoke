import { toNextJsHandler } from "better-auth/next-js";
import { getStokeAuth } from "../../../../server/auth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return toNextJsHandler(getStokeAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getStokeAuth()).POST(request);
}
