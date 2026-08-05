import { describe, expect, test } from "bun:test";
import { createRunSocketUrl, verifyRunSocketTicket } from "./run-tickets.ts";

describe("managed run socket tickets", () => {
  test("signs short-lived claims for the Vercel WebSocket endpoint", () => {
    const socketUrl = new URL(createRunSocketUrl("https://usestoke.dev/api/v1/runs/run-1/ticket", {
      runId: "run-1",
      userId: "user-1",
      role: "viewer",
    }));
    expect(socketUrl.protocol).toBe("wss:");
    expect(socketUrl.pathname).toBe("/api/ws");

    const claims = verifyRunSocketTicket(socketUrl.searchParams.get("ticket") ?? "");
    expect(claims).toMatchObject({ runId: "run-1", userId: "user-1", role: "viewer" });
    expect(claims.expiresAt).toBeGreaterThan(Date.now());
  });

  test("rejects tampered tickets", () => {
    const socketUrl = new URL(createRunSocketUrl("http://localhost:3000", {
      runId: "run-1",
      userId: "user-1",
      role: "producer",
    }));
    const ticket = socketUrl.searchParams.get("ticket") ?? "";
    expect(() => verifyRunSocketTicket(`${ticket}tampered`)).toThrow("Invalid run socket ticket");
  });
});
