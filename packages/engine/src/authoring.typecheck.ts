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
  .step("prepare", async () => ({ ctx: { snapshotId: "snap-1" } }))
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

sequence("typed-step-invalidation")
  .step("github-auth", async () => ({ ctx: { token: "ok" } }))
  .step("check-auth", async ({ step }) => {
    const token: string = step.ctx.token;
    void token;
    return step.invalidate("github-auth");
  });

sequence("typed-step-invalidation-targets")
  .step("github-auth", async () => ({ ctx: { token: "ok" } }))
  .step("check-auth", async ({ step }) => {
    // @ts-expect-error invalidation target must be a previous task id
    return step.invalidate("missing-auth");
  });

sequence("typed-config")
  .configure({
    nodeMajor: 22,
    tools: {
      codex: true,
      claude: false,
    },
  })
  .step("read-config", async ({ config }) => {
    const nodeMajor: number = config.nodeMajor;
    const codex: boolean = config.tools.codex;
    void nodeMajor;
    void codex;
    // @ts-expect-error missing config keys are rejected
    config.missing;
    return { ctx: { ready: true } };
  })
  .configure({
    tools: {
      claude: true,
    },
  })
  .step("merged-config", async ({ config }) => {
    const claude: boolean = config.tools.claude;
    void claude;
  });

sequence("duplicate-step-id")
  .step("prepare" as const, async () => ({ ctx: { snapshotId: "snap-1" } }))
  // @ts-expect-error duplicate task ids are rejected for literal ids
  .step("prepare" as const, async ({ step }) => ({ ctx: step.ctx }));

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
