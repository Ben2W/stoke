import { createServer, type IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { verifyRunSocketTicket, type RunSocketClaims } from "../src/server/run-tickets.js";
import {
  appendRunEvent,
  getRun,
  heartbeatRun,
  listRunEvents,
} from "../src/server/runs.js";

type RunRequest = IncomingMessage & { runClaims?: RunSocketClaims };

const server = createServer((_request, response) => {
  response.writeHead(426, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "websocket_upgrade_required" }));
});
const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request: RunRequest, socket, head) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ws") throw new Error("Unknown WebSocket route");
    const ticket = url.searchParams.get("ticket");
    if (!ticket) throw new Error("Missing run socket ticket");
    const claims = verifyRunSocketTicket(ticket);
    await getRun(claims.userId, claims.runId);
    request.runClaims = claims;
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      sockets.emit("connection", webSocket, request);
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

sockets.on("connection", (socket, request: RunRequest) => {
  const claims = request.runClaims;
  if (!claims) {
    socket.close(1008, "Missing run claims");
    return;
  }

  if (claims.role === "producer") attachProducer(socket, claims);
  else attachViewer(socket, claims);
});

function attachProducer(socket: WebSocket, claims: RunSocketClaims): void {
  let chain = Promise.resolve();
  socket.on("message", (raw) => {
    chain = chain.then(async () => {
      try {
        const message = parseMessage(raw);
        if (message.type === "heartbeat") {
          await heartbeatRun(claims.userId, claims.runId);
          send(socket, { type: "heartbeat.ack" });
          return;
        }
        if (message.type !== "event" || !("event" in message)) {
          throw new Error("Unknown producer message");
        }
        const event = await appendRunEvent(claims.userId, claims.runId, message.event);
        send(socket, {
          type: "event.ack",
          eventId: event.id,
          clientEventId: typeof message.id === "string" ? message.id : undefined,
        });
      } catch (error) {
        send(socket, { type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    });
  });
  send(socket, { type: "ready", runId: claims.runId, role: claims.role });
}

function attachViewer(socket: WebSocket, claims: RunSocketClaims): void {
  let cursor = 0;
  let polling = false;
  let closed = false;

  const poll = async () => {
    if (polling || closed || socket.readyState !== WebSocket.OPEN) return;
    polling = true;
    try {
      const [run, events] = await Promise.all([
        getRun(claims.userId, claims.runId),
        listRunEvents(claims.userId, claims.runId, cursor),
      ]);
      if (events.length) {
        cursor = events[events.length - 1]?.id ?? cursor;
        send(socket, { type: "events", events });
      }
      send(socket, { type: "run", run });
      if (run.status !== "running") {
        clearInterval(interval);
        windowlessTimeout(() => socket.close(1000, "Run finished"), 250);
      }
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      polling = false;
    }
  };

  const interval = setInterval(poll, 750);
  socket.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
  socket.on("message", (raw) => {
    try {
      const message = parseMessage(raw);
      if (message.type === "heartbeat") send(socket, { type: "heartbeat.ack" });
    } catch {
      socket.close(1003, "Invalid message");
    }
  });
  send(socket, { type: "ready", runId: claims.runId, role: claims.role });
  void poll();
}

function parseMessage(raw: RawData): Record<string, unknown> {
  const value = JSON.parse(raw.toString()) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) {
    throw new Error("Invalid WebSocket message");
  }
  return value as Record<string, unknown>;
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function windowlessTimeout(callback: () => void, delay: number): void {
  setTimeout(callback, delay);
}

export default server;

export const maxDuration = 300;
