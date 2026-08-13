import { describe, expect, test } from "bun:test";
import { createRunSocketUrl, verifyRunSocketTicket } from "./run-tickets.ts";

describe("managed run socket tickets", () => {
  test("signs short-lived claims for the run notification endpoint", () => {
    const socketUrl = new URL(createRunSocketUrl("https://usestoke.dev/api/v1/runs/run-1/ticket", {
      runId: "run-1",
      userId: "user-1",
    }));
    expect(socketUrl.protocol).toBe("wss:");
    expect(socketUrl.pathname).toBe("/api/ws");

    const claims = verifyRunSocketTicket(socketUrl.searchParams.get("ticket") ?? "");
    expect(claims).toMatchObject({ runId: "run-1", userId: "user-1" });
    expect(claims.expiresAt).toBeGreaterThan(Date.now());
  });

  test("rejects tampered tickets", () => {
    const socketUrl = new URL(createRunSocketUrl("http://localhost:3000", {
      runId: "run-1",
      userId: "user-1",
    }));
    const ticket = socketUrl.searchParams.get("ticket") ?? "";
    expect(() => verifyRunSocketTicket(`${ticket}tampered`)).toThrow("Invalid run socket ticket");
  });

  test("signs user-scoped dashboard tickets without granting another user access", () => {
    const socketUrl = new URL(createRunSocketUrl("https://usestoke.dev", { userId: "user-1" }));
    expect(verifyRunSocketTicket(socketUrl.searchParams.get("ticket") ?? ""))
      .toMatchObject({ userId: "user-1" });
    expect(verifyRunSocketTicket(socketUrl.searchParams.get("ticket") ?? "").runId).toBeUndefined();
  });
});
