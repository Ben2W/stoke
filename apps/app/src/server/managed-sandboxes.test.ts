import { describe, expect, test } from "bun:test";
import type { ManagedProject } from "@usestoke/managed";
import {
  createManagedSandbox,
  ManagedSandboxNotFoundError,
  runManagedSandboxCommand,
  snapshotManagedSandbox,
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
  test("creates an empty setup sandbox", async () => {
    let createInput: any;
    const result = await createManagedSandbox("user-1", {
      projectId: project.id,
      source: { type: "empty" },
      runtime: "node24",
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
      ports: [3000],
      persistent: true,
      tags: { service: "stoke" },
    });
    expect(result).toEqual({
      name: "quiet-otter",
      domains: { "3000": "https://3000.quiet-otter.example" },
    });
  });

  test("creates a workspace sandbox from a cached snapshot", async () => {
    let createInput: any;
    await createManagedSandbox("user-1", {
      projectId: project.id,
      source: { type: "snapshot", snapshotId: "snap_prepared" },
      runtime: "node24",
      ports: [3000],
    }, {
      getProject: async () => project,
      create: async (input) => {
        createInput = input;
        return {
          name: "workspace-sandbox",
          tags: input.tags,
          domain: (port: number) => `https://${port}.workspace.example`,
        } as any;
      },
    });

    expect(createInput).toMatchObject({
      source: { type: "snapshot", snapshotId: "snap_prepared" },
      ports: [3000],
      persistent: true,
    });
    expect(createInput).not.toHaveProperty("runtime");
  });

  test("snapshots an owned setup sandbox", async () => {
    const sandbox = {
      name: "setup-sandbox",
      tags: {
        service: "stoke",
        owner: "c6c289e49e9c05b2145860387b73bcb1",
        project: "07fd68ba45969a2cfbb949331c69fbf9",
      },
      snapshot: async (options: unknown) => {
        expect(options).toEqual({ expiration: 0 });
        return { snapshotId: "snap_prepared" };
      },
    };

    await expect(snapshotManagedSandbox("user-1", sandbox.name, {
      projectId: project.id,
      expiration: 0,
    }, {
      getProject: async () => project,
      get: async () => sandbox as any,
    })).resolves.toEqual({ snapshotId: "snap_prepared" });
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
      source: { type: "empty" },
      runtime: "node24",
      ports: [],
    }, dependencies as any);
    await stopManagedSandbox("user-1", created.name, project.id, dependencies as any);
    expect(created.stopped).toBe(true);
  });
});
