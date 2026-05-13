import { sequence } from "./authoring.ts";

sequence("normal-operation-ids")
  .operation("open" as const, {
    run: async () => null,
  })
  // @ts-expect-error duplicate operation ids are rejected for literal ids
  .operation("open" as const, {
    run: async () => null,
  });

sequence("workspace-operation-ids")
  .step("prepare", async () => ({ snapshotId: "snap-1" }))
  .workspace({
    create: async ({ workflow, workspace }) => {
      const snapshotId: string = workflow.ctx.snapshotId;
      const name: string = workspace.name;
      void snapshotId;
      void name;
      return { vmId: "vm-1", test: "ok" };
    },
    remove: async ({ workspace }) => {
      const vmId: string = workspace.ctx.vmId;
      const test: string = workspace.ctx.test;
      void vmId;
      void test;
      // @ts-expect-error workspace context is read-only
      workspace.ctx.vmId = "next";
      // @ts-expect-error provider resources are not part of the workspace authoring API
      workspace.resources;
    },
  })
  .workspaceOperation("open-cmux" as const, {
    run: async ({ workspace }) => {
      const vmId: string = workspace.ctx.vmId;
      void vmId;
      // @ts-expect-error missing data properties are rejected
      workspace.ctx.missing;
      return null;
    },
  })
  // @ts-expect-error duplicate workspace operation ids are rejected for literal ids
  .workspaceOperation("open-cmux" as const, {
    run: async () => null,
  });

sequence("reserved-operation-id")
  // @ts-expect-error reserved operation ids are rejected for literal ids
  .operation("create" as const, {
    run: async () => null,
  });

sequence("reserved-workspace-operation-id")
  .workspace({
    create: async () => ({}),
    remove: async () => {},
  })
  // @ts-expect-error reserved workspace operation ids are rejected for literal ids
  .workspaceOperation("remove" as const, {
    run: async () => null,
  });

sequence("slash-operation-id")
  // @ts-expect-error operation ids cannot contain slashes
  .operation("workspace/open" as const, {
    run: async () => null,
  });
