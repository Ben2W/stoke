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
  .workspace({
    create: async () => ({}),
    remove: async () => {},
  })
  .workspaceOperation("open-cmux" as const, {
    run: async () => null,
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
