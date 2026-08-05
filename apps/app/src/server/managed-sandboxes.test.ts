import { describe, expect, test } from "bun:test";
import type { ManagedProject } from "@usestoke/managed";
import {
  createManagedSandbox,
  ManagedSandboxNotFoundError,
  runManagedSandboxCommand,
  stopManagedSandbox,
} from "./managed-sandboxes.ts";

const project: ManagedProject = {
  id: "f95df42b-48da-4a02-926b-60def0ee77cf",
  slug: "ben2w-stoke-example",
  name: "stoke-example",
  source: { kind: "github", owner: "ben2w", repository: "stoke-example" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("managed Vercel Sandboxes", () => {
  test("creates from the managed project's public GitHub source", async () => {
    let createInput: any;
    const result = await createManagedSandbox("user-1", {
      projectId: project.id,
      runtime: "node24",
      revision: "main",
      ports: [3000],
    }, {
      getProject: async () => project,
      create: async (input) => {
        createInput = input;
        return {
          name: "quiet-otter",
          tags: input.tags,
          domain: (port: number) => `https://${port}.quiet-otter.example`,
        } as any;
      },
    });

    expect(createInput).toMatchObject({
      runtime: "node24",
      source: {
        type: "git",
        url: "https://github.com/ben2w/stoke-example.git",
        revision: "main",
      },
      ports: [3000],
      persistent: true,
      tags: { service: "stoke" },
    });
    expect(result).toEqual({
      name: "quiet-otter",
      domains: { "3000": "https://3000.quiet-otter.example" },
    });
  });

  test("rejects a sandbox that is not tagged for the user and project", async () => {
    const sandbox = { name: "other", tags: { service: "stoke", owner: "wrong", project: "wrong" } };
    await expect(runManagedSandboxCommand("user-1", "other", {
      projectId: project.id,
      cmd: "pwd",
      args: [],
      detached: false,
    }, {
      getProject: async () => project,
      get: async () => sandbox as any,
    })).rejects.toBeInstanceOf(ManagedSandboxNotFoundError);
  });

  test("stops only an owned sandbox", async () => {
    let created: any;
    const dependencies = {
      getProject: async () => project,
      create: async (input: any) => {
        created = {
          name: "quiet-otter",
          tags: input.tags,
          domain: () => "https://quiet-otter.example",
          stop: async () => {
            created.stopped = true;
          },
        };
        return created;
      },
      get: async () => created,
    };
    await createManagedSandbox("user-1", {
      projectId: project.id,
      runtime: "node24",
      ports: [],
    }, dependencies as any);
    await stopManagedSandbox("user-1", created.name, project.id, dependencies as any);
    expect(created.stopped).toBe(true);
  });
});
