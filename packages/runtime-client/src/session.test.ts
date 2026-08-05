import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WebSocketServer } from "ws";
import { runtimeSessionEffect } from "./session.ts";

describe("runtime session", () => {
  test("processes backlogged messages in wire order before closing", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("WebSocket test server did not bind");

    server.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(JSON.stringify({ type: "run.event", event: { type: "node.cached" } }));
        socket.send(JSON.stringify({ type: "run.completed" }));
      });
    });

    const observed: string[] = [];
    try {
      await Effect.runPromise(runtimeSessionEffect(
        `http://127.0.0.1:${address.port}`,
        "test-token",
        "/session",
        {
          async onMessage(message, session) {
            const type = typeof message === "object" && message !== null && "type" in message
              ? String(message.type)
              : "unknown";
            if (type === "run.event") await new Promise((resolve) => setTimeout(resolve, 25));
            observed.push(type);
            if (type === "run.completed") session.close();
          },
        },
      ));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(observed).toEqual(["run.event", "run.completed"]);
  });
});
