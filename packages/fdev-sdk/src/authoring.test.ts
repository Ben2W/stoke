import { describe, expect, test } from "bun:test";
import { defineDevMachine, defineMigration, isDevMachine, isMigration } from "./authoring.ts";

describe("fdev SDK authoring", () => {
  test("creates structural migration and machine definitions", () => {
    const migration = defineMigration("test:migration", async () => {});
    const machine = defineDevMachine({
      name: "test",
      apiKey: "test-key",
      image: "ubuntu-24.04",
      migrations: [migration],
    });

    expect(migration.kind).toBe("fdev.migration");
    expect(machine.kind).toBe("fdev.machine");
    expect(isMigration({ kind: "fdev.migration" })).toBe(true);
    expect(isDevMachine({ kind: "fdev.machine" })).toBe(true);
  });
});
