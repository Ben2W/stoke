import { describe, expect, test } from "bun:test";
import {
  defineDevMachine,
  defineStep,
  isDevMachine,
  isStep,
} from "./authoring.ts";

describe("fdev SDK authoring", () => {
  test("creates structural step and machine definitions", () => {
    const step = defineStep("test:step", async () => {});
    const machine = defineDevMachine({
      name: "test",
      apiKey: "test-key",
      image: "ubuntu-24.04",
      steps: [step],
    });

    expect(step.kind).toBe("fdev.step");
    expect(machine.kind).toBe("fdev.machine");
    expect(isStep({ kind: "fdev.step" })).toBe(true);
    expect(isDevMachine({ kind: "fdev.machine" })).toBe(true);
  });

  test("checks step dependencies when defining a machine", () => {
    const gcloud = defineStep("install gcloud", async () => {
      return { ctx: { gcloudVersion: "1.0.0" } };
    });
    const node = defineStep(
      "install node",
      { dependsOn: [gcloud] },
      async ({ ctx }) => {
        const version = ctx.get("gcloudVersion");
        expect(version).toBeTypeOf("string");
      },
    );

    expect(() =>
      defineDevMachine({
        name: "test",
        apiKey: "test-key",
        image: "ubuntu-24.04",
        steps: [node],
      }),
    ).toThrow("depends on install gcloud");

    expect(() =>
      defineDevMachine({
        name: "test",
        apiKey: "test-key",
        image: "ubuntu-24.04",
        steps: [gcloud, node],
      }),
    ).not.toThrow();
  });
});
