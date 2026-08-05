import { describe, expect, test } from "bun:test";
import type { ManagedProject } from "@usestoke/managed";
import { hasExampleProject } from "./add-project-options.tsx";

const project = (owner: string, repository: string): ManagedProject => ({
  id: `${owner}/${repository}`,
  slug: repository,
  name: repository,
  source: { kind: "github", owner, repository },
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
});

describe("Stoke example project option", () => {
  test("recognizes the example by case-insensitive GitHub identity", () => {
    expect(hasExampleProject([project("ben2w", "STOKE-EXAMPLE")])).toBe(true);
    expect(hasExampleProject([project("vercel", "next.js")])).toBe(false);
  });
});
