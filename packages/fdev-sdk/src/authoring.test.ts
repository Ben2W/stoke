import { describe, expect, test } from "bun:test";
import {
  defineDevMachine,
  defineProvider,
  defineStep,
  isDevMachine,
  isProviderDefinition,
  isStep,
} from "./authoring.ts";

describe("fdev SDK authoring", () => {
  test("creates structural step and machine definitions", () => {
    const step = defineStep("test:step", async () => {});
    const provider = defineProvider("test", { token: "test-key" });
    const machine = defineDevMachine({
      name: "test",
      provider,
      steps: [step],
    });

    expect(step.kind).toBe("fdev.step");
    expect(provider.kind).toBe("fdev.provider");
    expect(machine.kind).toBe("fdev.machine");
    expect(isStep({ kind: "fdev.step" })).toBe(true);
    expect(isProviderDefinition({ kind: "fdev.provider" })).toBe(true);
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
        const typedVersion: string = version;
        expect(version).toBeTypeOf("string");
        expect(typedVersion).toBe("1.0.0");
      },
    );

    expect(() =>
      defineDevMachine({
        name: "test",
        provider: defineProvider("test", { token: "test-key" }),
        steps: [node],
      }),
    ).toThrow("depends on install gcloud");

    expect(() =>
      defineDevMachine({
        name: "test",
        provider: defineProvider("test", { token: "test-key" }),
        steps: [gcloud, node],
      }),
    ).not.toThrow();
  });
});
