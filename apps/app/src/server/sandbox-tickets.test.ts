import { describe, expect, test } from "bun:test";
import { createSandboxTicket, verifySandboxTicket } from "./sandbox-tickets.ts";

describe("sandbox execution tickets", () => {
  test("round-trips short-lived project-scoped credentials", () => {
    const ticket = createSandboxTicket("user-1", "project-1");
    expect(verifySandboxTicket(ticket)).toMatchObject({
      userId: "user-1",
      projectId: "project-1",
    });
  });

  test("rejects modified credentials", () => {
    const ticket = createSandboxTicket("user-1", "project-1");
    expect(verifySandboxTicket(`${ticket}modified`)).toBeUndefined();
  });
});
