import { describe, expect, test } from "bun:test";
import { shortFingerprint } from "./fingerprint.ts";

describe("fingerprint formatting", () => {
  test("uses a Git-style leading hash without its storage prefix", () => {
    expect(shortFingerprint("remote:e587a05a934ac7be12bf5233102939d4479f8625")).toBe("e587a05a");
    expect(shortFingerprint("cache:7d860ec0acbd")).toBe("7d860ec0");
    expect(shortFingerprint("workflow:f053ad6507630f9a")).toBe("f053ad65");
    expect(shortFingerprint("sha256-abc123def456")).toBe("abc123de");
  });
});
