import { describe, expect, test } from "bun:test";
import {
  defaultProjectSlug,
  keyForProjectSource,
  normalizeProjectSource,
} from "./projects.ts";

describe("managed project identity", () => {
  test("normalizes GitHub identity independently of display casing", () => {
    const source = normalizeProjectSource({
      kind: "github",
      owner: "Ben2W",
      repository: "Stoke",
      url: "https://github.com/Ben2W/Stoke",
    });

    expect(source).toEqual({
      kind: "github",
      owner: "ben2w",
      repository: "stoke",
      url: "https://github.com/Ben2W/Stoke",
    });
    expect(keyForProjectSource(source)).toBe("github:ben2w/stoke");
  });

  test("keeps local identities scoped to a device and path", () => {
    expect(
      keyForProjectSource({
        kind: "local",
        machineId: "device-1",
        machineName: "Benjamin's MacBook",
        path: "/Users/ben/project",
      }),
    ).toBe("local:device-1:/Users/ben/project");
  });

  test("builds stable, bounded default slugs", () => {
    const source = { kind: "github", owner: "Ben2W", repository: "Stoke" } as const;
    expect(defaultProjectSlug("Ignored", source)).toBe("ben2w-stoke");
    expect(defaultProjectSlug("Ignored", { ...source, repository: "x".repeat(80) })).toHaveLength(63);
  });
});
