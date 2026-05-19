import { describe, expect, test } from "bun:test";
import { evaluateVersionCompatibility } from "./version-compat.ts";

describe("version compatibility", () => {
  test("allows patch mismatches", () => {
    const report = evaluateVersionCompatibility({
      cliVersion: "0.2.12",
      runtimeVersion: "0.2.11",
      engineVersion: "0.2.10",
    });

    expect(report.severity).toBe("ok");
    expect(report.issues).toEqual([]);
  });

  test("warns for minor CLI/runtime mismatches", () => {
    const report = evaluateVersionCompatibility({
      cliVersion: "0.2.12",
      runtimeVersion: "0.3.0",
      engineVersion: "0.3.0",
    });

    expect(report.severity).toBe("warning");
    expect(report.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        subject: "cli-runtime",
      }),
    ]);
  });

  test("errors for major CLI/runtime mismatches", () => {
    const report = evaluateVersionCompatibility({
      cliVersion: "0.2.12",
      runtimeVersion: "1.0.0",
      engineVersion: "1.0.0",
    });

    expect(report.severity).toBe("error");
    expect(report.issues).toEqual([
      expect.objectContaining({
        severity: "error",
        subject: "cli-runtime",
      }),
    ]);
  });

  test("warns when project runtime and engine minor versions differ", () => {
    const report = evaluateVersionCompatibility({
      cliVersion: "0.2.12",
      runtimeVersion: "0.2.12",
      engineVersion: "0.3.0",
    });

    expect(report.severity).toBe("warning");
    expect(report.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        subject: "runtime-engine",
      }),
    ]);
  });
});
