import {
  experimental_upgradeWebSocket,
  type WebSocket,
} from "@vercel/functions";
import postgres from "postgres";
import { getRun } from "./runs.ts";
import { verifyRunSocketTicket } from "./run-tickets.ts";

export const RUN_NOTIFICATION_CHANNEL = "stoke_run_changes";
const KEEPALIVE_INTERVAL_MS = 20_000;

export async function upgradeRunNotificationSocket(request: Request): Promise<Response> {
  let claims;
  try {
    const ticket = new URL(request.url).searchParams.get("ticket");
    if (!ticket) throw new Error("Missing run socket ticket");
    claims = verifyRunSocketTicket(ticket);
    if (claims.runId) await getRun(claims.userId, claims.runId);
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return await experimental_upgradeWebSocket(async (socket) => {
    const databaseUrl = process.env.DATABASE_URL_UNPOOLED;
    if (!databaseUrl) {
      socket.close(1011, "DATABASE_URL_UNPOOLED is not configured");
      return;
    }

    const sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 0,
      connect_timeout: 10,
    });
    let closed = false;
    let cleaned = false;
    let listener: Awaited<ReturnType<typeof sql.listen>> | undefined;
    const keepalive = setInterval(() => send(socket, { type: "notification.ping" }), KEEPALIVE_INTERVAL_MS);

    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepalive);
      await listener?.unlisten().catch(() => undefined);
      await sql.end({ timeout: 1 }).catch(() => undefined);
    };

    socket.on("close", () => {
      closed = true;
      void cleanup();
    });
    socket.on("error", () => {
      closed = true;
      void cleanup();
    });

    try {
      listener = await sql.listen(RUN_NOTIFICATION_CHANNEL, (payload) => {
        const change = parseRunChange(payload);
        if (
          change
          && change.userId === claims.userId
          && (!claims.runId || change.runId === claims.runId)
        ) send(socket, { type: "run.changed", runId: change.runId });
      });
      if (closed) {
        await cleanup();
        return;
      }
      send(socket, { type: "notification.ready", ...(claims.runId ? { runId: claims.runId } : {}) });
      // NOTIFY only wakes the client. HTTP refetches remain authoritative and
      // this initial signal catches changes missed during reconnects.
      send(socket, claims.runId
        ? { type: "run.changed", runId: claims.runId }
        : { type: "runs.changed" });
    } catch (error) {
      send(socket, {
        type: "notification.error",
        message: error instanceof Error ? error.message : String(error),
      });
      socket.close(1011, "Could not listen for run notifications");
      await cleanup();
    }
  });
}

export function parseRunChange(payload: string): { runId: string; userId: string } | undefined {
  try {
    const value = JSON.parse(payload) as unknown;
    if (
      typeof value !== "object"
      || value === null
      || !("runId" in value)
      || typeof value.runId !== "string"
      || !("userId" in value)
      || typeof value.userId !== "string"
    ) return undefined;
    return { runId: value.runId, userId: value.userId };
  } catch {
    return undefined;
  }
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
