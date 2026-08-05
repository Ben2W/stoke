import { handle } from "hono/vercel";
import { api } from "../../../../server/api.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = handle(api);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
