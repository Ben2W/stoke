import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevMachineEngine, type InteractionPresentationRequest } from "./engine.ts";
import { createStateStore, StateStore, type StateServiceFactory } from "./state.ts";
import type {
  BaseProviderPlugin,
  ProviderRuntimeContext,
  WorkflowProviderController,
} from "./provider/types.ts";
import type { DevMachineEvent, ExecResult, JsonValue, WorkflowProviderCheckResult } from "./types.ts";

function stokeIndexPath(projectDir: string): string {
  return join(projectDir, "stoke", "index.ts");
}

function writeStokeIndex(projectDir: string, contents: string): string {
  const configPath = stokeIndexPath(projectDir);
  mkdirSync(join(projectDir, "stoke"), { recursive: true });
  writeFileSync(configPath, contents);
  return configPath;
}

function createScopedTestState(projectDir: string) {
  const scopes = new Map<string, StateStore>();
  const stateFactory: StateServiceFactory = (options) => {
    const scope = options.scope ?? "project";
    let state = scopes.get(scope);
    if (!state) {
      state = new StateStore({ ...options, projectDir, scope });
      scopes.set(scope, state);
    }
    return state;
  };
  return {
    project: stateFactory({ projectDir, scope: "project" }),
    stateFactory,
    scopes,
  };
}

describe("DevMachineEngine workflow runtime", () => {
  test("preserves persisted workspace operations when the current workflow definition changes", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-workspace-operations-"));
    const state = createStateStore({ projectDir });
    state.saveWorkspace({
      id: "workspace-1",
      name: "demo",
      workflow: "dev",
      workflowCtx: {},
      ctx: {},
      operations: [{ id: "old", requiredCapabilities: [] }],
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    writeStokeIndex(projectDir, `
      import { workflow, z } from "${import.meta.dir}/index.ts";
      export const dev = workflow("dev")
        .sequence("dev")
        .workspace({ create: async () => ({}), remove: async () => {} })
        .workspaceOperation("preview", {
          title: "Open preview",
          input: z.object({ path: z.string().default("/") }),
          run: async () => ({ ok: true }),
        });
    `);

    const engine = await createDevMachineEngine({ projectDir, state });
    await engine.load();

    expect(engine.listWorkspaces()[0]?.operations).toEqual([{
      id: "old",
      requiredCapabilities: [],
    }]);
  });

  test("infers operation host capabilities from the captured provider scope", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-capability-manifest-"));
    writeStokeIndex(projectDir, `
      import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

      const terminal = defineProvider("terminal", {}, {
        providerId: "terminal",
        capabilities: [{ id: "ssh", schemaHash: "sha256:ssh-v1" }],
        createProvider: () => ({ providerId: "terminal", runtime: () => ({}) }),
      });

      export const root = workflow("capabilities")
        .sequence("capabilities")
        .addProvider("terminal", terminal)
        .operation("shell", { run: async () => ({ ok: true }) })
        .removeProvider("terminal")
        .operation("status", { run: async () => ({ ok: true }) });
    `);

    const engine = await createDevMachineEngine({ projectDir });
    await engine.load();

    expect(engine.listRuntimeOperations().find((operation) => operation.id === "shell")?.requiredCapabilities)
      .toEqual([{ id: "ssh", schemaHash: "sha256:ssh-v1" }]);
    expect(engine.listRuntimeOperations().find((operation) => operation.id === "status")?.requiredCapabilities)
      .toEqual([]);
  });

  test("rejects non-canonical config paths", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-noncanonical-config-"));
    const configPath = join(projectDir, "rig.config.ts");
    writeFileSync(configPath, "export const dev = {}\n");

    await expect(createDevMachineEngine({ projectDir, configPath })).rejects.toThrow(
      `Stoke config must be ${stokeIndexPath(projectDir)}; ${configPath} is not supported.`,
    );
  });

  test("plans, applies graph nodes, reuses graph cache, and forks workspaces", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow, z } from "${import.meta.dir}/index.ts";

        const testProvider = defineProvider("test", { token: "test-key" });
        const app = workflow("test");

        const base = app.sequence("base").addProvider("test", testProvider).task("first", async ({ step, providers }) => {
          console.log("preparing base");
          const vm = await providers.test.createVm();
          await vm.exec("touch /tmp/first", { name: "touch first" });
          if (!(await vm.exists("/tmp/first"))) throw new Error("first was not created");
          return { ctx: { first: true, vm: await vm.snapshotRef() } };
        });

        const left = app.sequence("left").addProvider("test", testProvider).task("second", async ({ step, providers }) => {
          if (!step.ctx.first) throw new Error("missing first context");
          const vm = await providers.test.fromSnapshot(step.ctx.vm);
          await vm.exec("touch /tmp/second", { name: "touch second" });
          return { ctx: { second: true, vm: await vm.snapshotRef() } };
        });

        const right = app.sequence("right").task("data", async ({ step }) => {
          if (!step.ctx.first) throw new Error("missing first context");
          return { ctx: { data: "right-ready" } };
        });

        export const test = app
          .sequence("root")
          .add(base)
          .parallel({ left, right })
          .task("join", async ({ step }) => {
            if (!step.ctx.left.second) throw new Error("missing left context");
            if (step.ctx.right.data !== "right-ready") throw new Error("missing right context");
            return { ctx: { vm: step.ctx.left.vm, summary: step.ctx.right.data } };
          })
          .addProvider("test", testProvider)
          .workspace({
            create: async ({ providers, workflow, workspace, local }) => {
              if (workflow.ctx.summary !== "right-ready") throw new Error("missing final context");
              const vm = await providers.test.fromSnapshot(workflow.ctx.vm);
              await vm.exec("touch /tmp/workspace-" + workspace.name, { name: "mark workspace" });
              await local.open("created://" + workspace.name);
              return {
                summary: workflow.ctx.summary,
                repoPath: "/workspace/repo",
                vmId: vm.vmId,
              };
            },
            remove: async ({ providers, workspace, workflow }) => {
              if (workflow.ctx.summary !== "right-ready") throw new Error("missing final context on remove");
              const vm = providers.test.fromId(workspace.ctx.vmId);
              await vm.exec("touch /tmp/remove-" + workspace.name, { name: "mark workspace remove" });
            },
          })
          .workspaceOperation("open", {
            run: async ({ providers, workspace, workflow, local }) => {
              if (workflow.ctx.summary !== "right-ready") throw new Error("missing final context on open");
              if (workspace.ctx.summary !== "right-ready") throw new Error("missing workspace context");
              const vm = providers.test.fromId(workspace.ctx.vmId);
              await vm.exec("touch /tmp/open-" + workspace.name, { name: "mark workspace open" });
              await local.open("open://" + workspace.name);
            },
          })
          .workspaceOperation("mark", {
            input: z.object({
              label: z.string().default("marked"),
            }),
            run: async ({ input, providers, local, workspace }) => {
              const vm = providers.test.fromId(workspace.ctx.vmId);
              await vm.exec("touch /tmp/mark-" + workspace.name, { name: "mark via operation" });
              await local.open("mark://" + workspace.name);
              return {
                workspace: workspace.name,
                label: input.label,
                repoPath: workspace.ctx.repoPath,
                summary: workspace.ctx.summary,
              };
            },
          });
      `,
    );

    const opened: string[] = [];
    const events: DevMachineEvent[] = [];
    const provider = new FakeWorkflowProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: async () => provider,
      local: {
        open: async (target) => {
          opened.push(target);
        },
      },
    });
    engine.onEvent((event) => events.push(event));

    await engine.load();

    const initial = await engine.plan({ workflow: "test" });
    expect(initial.workflow).toBe("test");
    expect(initial.cachedNodeCount).toBe(0);
    expect(initial.nodeCount).toBe(4);
    expect(initial.nodes.map((node) => node.path)).toEqual([
      "base.first",
      "left.second",
      "right.data",
      "join",
    ]);

    const applied = await engine.apply({ workflow: "test" });
    expect(applied.context.vm).toEqual({ provider: "test", kind: "vmSnapshot", snapshotId: "snap-2" });
    expect(events).toContainEqual({
      type: "log.output",
      nodePath: "base.first",
      stream: "info",
      data: "preparing base",
    });
    expect(provider.snapshots).toHaveLength(2);
    expect(engine.listNodeRuns()).toHaveLength(4);

    const cached = await engine.plan({ workflow: "test" });
    expect(cached.cachedNodeCount).toBe(4);
    expect(cached.finalContext?.summary).toBe("right-ready");

    const workspace = await engine.fork({ workflow: "test", name: "work" });
    expect(workspace.name).toBe("work");
    expect(workspace.ctx).toMatchObject({
      summary: "right-ready",
      repoPath: "/workspace/repo",
      vmId: "vm-3",
    });
    expect(engine.listWorkspaces()).toHaveLength(1);
    expect(opened).toEqual(["created://work"]);
    expect(provider.hasFile("vm-3", "/tmp/workspace-work")).toBe(true);

    const openOperation = engine.listRuntimeWorkspaceOperations().find((operation) => operation.id === "open");
    expect(openOperation?.id).toBe("open");
    const marked = await engine.runRuntimeOperation({ operation: "work/mark", input: {} });
    expect(marked).toEqual({ workspace: "work", label: "marked", repoPath: "/workspace/repo", summary: "right-ready" });
    expect(opened).toEqual(["created://work", "mark://work"]);
    expect(provider.hasFile("vm-3", "/tmp/mark-work")).toBe(true);

    await engine.runRuntimeOperation({ operation: "work/open" });
    expect(opened).toEqual(["created://work", "mark://work", "open://work"]);
    expect(provider.hasFile("vm-3", "/tmp/open-work")).toBe(true);

    await engine.runRuntimeOperation({ operation: "work/remove" });
    expect(engine.listWorkspaces()).toHaveLength(0);
    expect(provider.hasFile("vm-3", "/tmp/remove-work")).toBe(true);
  });

  test("creates workspaces from workspace definitions and exposes persisted workspace context", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const test = defineProvider("test", { token: "test-key" });

        const app = workflow("create-test");

        export const root = app.sequence("create-test")
          .addProvider("test", test)
          .step("prepare", async ({ providers }) => {
            const vm = await providers.test.createVm();
            await vm.exec("touch /tmp/template", { name: "prepare template" });
            return {
              ctx: {
                vm: await vm.snapshotRef(),
                repoPath: "/workspace/repo",
              },
            };
          })
          .workspace({
            create: async ({ workflow, workspace, providers }) => {
              const vm = await providers.test.fromSnapshot(workflow.ctx.vm);
              await vm.exec("touch /tmp/create-" + workspace.name, { name: "create workspace" });
              return {
                name: workspace.name,
                vmId: vm.vmId,
                sourceSnapshot: workflow.ctx.vm,
                repoPath: workflow.ctx.repoPath,
                ready: true,
              };
            },
            remove: async () => {},
          })
          .workspaceOperation("inspect", {
            run: async ({ workspace, local }) => {
              await local.open("created://" + workspace.name);
              return {
                vmId: workspace.ctx.vmId,
                repoPath: workspace.ctx.repoPath,
                ready: workspace.ctx.ready,
              };
            },
          })
          .workspaceOperation("status", {
            run: async ({ workspace }) => ({
              workspace: workspace.name,
              vmId: workspace.ctx.vmId,
            }),
          });

      `,
    );

    const opened: string[] = [];
    const provider = new FakeWorkflowProvider();
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
      workspaceCreatedFrom: { kind: "checkout", deviceId: "device-1", checkoutId: "checkout-1" },
      workspaceSourceRevision: "597e6932ead77fbf8653705e168ea46601b3e285",
      local: {
        open: async (target) => {
          opened.push(target);
        },
      },
    });

    await engine.load();
    const projectInfo = engine.getProjectInfo();
    expect(projectInfo.workflows[0]?.createsWorkspace).toBe(true);
    expect(projectInfo.workflows.map((workflow) => workflow.name)).toEqual(["create-test"]);
    expect(engine.listRuntimeWorkspaceOperations().map((operation) => operation.id)).toEqual(["remove", "inspect", "status"]);

    const workspace = await engine.fork({ workflow: "create-test", name: "created" });
    expect(workspace.name).toBe("created");
    expect(workspace.sourceRevision).toBe("597e6932ead77fbf8653705e168ea46601b3e285");
    expect(workspace.cacheEntryIds).toEqual(engine.listNodeRuns().map((run) => run.id));
    expect(workspace.createdFrom).toEqual({ kind: "checkout", deviceId: "device-1", checkoutId: "checkout-1" });
    expect(workspace.ctx).toMatchObject({
      name: "created",
      vmId: "vm-2",
      repoPath: "/workspace/repo",
      ready: true,
    });
    expect(workspace.operations.map((operation) => operation.id)).toEqual(["inspect", "status"]);
    expect(provider.hasFile("vm-2", "/tmp/create-created")).toBe(true);

    const inspected = await engine.runRuntimeOperation({ operation: "created/inspect" });
    expect(inspected).toEqual({
      vmId: "vm-2",
      repoPath: "/workspace/repo",
      ready: true,
    });
    expect(opened).toEqual(["created://created"]);

    const status = await engine.runRuntimeOperation({ operation: "created/status" });
    expect(status).toEqual({ workspace: "created", vmId: "vm-2" });
  });

  test("runs workspace operations with scalar inputs", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { sequence, z } from "${import.meta.dir}/index.ts";

        export const root = sequence("workspace-operation-inputs")
          .step("ready", async () => ({ ctx: { repoPath: "/workspace/repo" } }))
          .workspace({
            create: async ({ workflow, workspace }) => ({
              name: workspace.name,
              repoPath: workflow.ctx.repoPath,
            }),
            remove: async () => {},
          })
          .workspaceOperation("test", {
            input: z.object({
              pattern: z.string().optional().describe("Optional test name or file pattern"),
              bail: z.boolean().default(false).describe("Stop after the first failure"),
              retries: z.number().default(1).describe("Retry count"),
              scope: z.string()
                .refine((value) => value.startsWith("test:"), "scope must start with test:")
                .default("test:unit")
                .describe("Test scope"),
            }),
            run: async ({ input, workspace }) => ({
              workspace: workspace.name,
              repoPath: workspace.ctx.repoPath,
              pattern: input.pattern ?? null,
              bail: input.bail,
              retries: input.retries,
              scope: input.scope,
            }),
          });

      `,
    );

    const engine = await createDevMachineEngine({ projectDir });
    await engine.load();
    await engine.fork({ workflow: "workspace-operation-inputs", name: "created" });

    const operation = engine.listRuntimeWorkspaceOperations().find((item) => item.id === "test");
    expect(operation?.inputFields).toEqual([]);
    expect(operation?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        pattern: { type: "string", description: "Optional test name or file pattern" },
        bail: { type: "boolean", description: "Stop after the first failure", default: false },
        retries: { type: "number", description: "Retry count", default: 1 },
        scope: { type: "string", description: "Test scope", default: "test:unit" },
      },
    });

    await expect(engine.runRuntimeOperation({
      operation: "created/test",
      input: { workflow: "workspace-operation-inputs", pattern: "auth", bail: true, retries: 3, scope: "test:auth" },
    })).resolves.toEqual({
      workspace: "created",
      repoPath: "/workspace/repo",
      pattern: "auth",
      bail: true,
      retries: 3,
      scope: "test:auth",
    });

    await expect(engine.runWorkspaceOperation({
      workflow: "workspace-operation-inputs",
      workspace: "created",
      operation: "test",
      input: {},
    })).resolves.toEqual({
      workspace: "created",
      repoPath: "/workspace/repo",
      pattern: null,
      bail: false,
      retries: 1,
      scope: "test:unit",
    });

    await expect(engine.runWorkspaceOperation({
      workflow: "workspace-operation-inputs",
      workspace: "created",
      operation: "test",
      input: { scope: "auth" },
    })).rejects.toThrow("scope must start with test:");
  });

  test("rejects workspace names that are not shell-safe", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        export const root = sequence("workspace-names")
          .step("ready", async () => ({ ctx: { ready: true } }))
          .workspace({
            create: async ({ workspace }) => ({ name: workspace.name }),
            remove: async () => {},
          });

      `,
    );

    const engine = await createDevMachineEngine({ projectDir });
    await engine.load();

    await expect(engine.fork({ workflow: "workspace-names", name: "" })).rejects.toThrow("create requires a workspace name");
    for (const name of ["some workspace", "some/workspace", "-workspace"]) {
      await expect(engine.fork({ workflow: "workspace-names", name })).rejects.toThrow("Workspace name");
    }
    expect(engine.listWorkspaces()).toEqual([]);
  });

  test("loads multiple named workflow exports", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        export const api = sequence("api").step("ready", async () => ({ ctx: { api: true } }));
        export const web = sequence("web").step("ready", async () => ({ ctx: { web: true } }));
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
    });

    await engine.load();

    expect(engine.listWorkflowSummaries().map((workflow) => workflow.name)).toEqual(["api", "web"]);
    await expect(engine.plan()).rejects.toThrow("Pass --workflow");
    expect((await engine.plan({ workflow: "api" })).workflow).toBe("api");
  });

  test("creates state through an injectable state service factory", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        export const root = sequence("factory-test").step("ready", async () => ({ ctx: { ready: true } }));
      `,
    );

    const configPath = stokeIndexPath(projectDir);
    const calls: Array<{ projectDir: string; configPath?: string; scope?: string }> = [];
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
      stateFactory: (options) => {
        calls.push({
          projectDir: options.projectDir,
          configPath: options.configPath,
          scope: options.scope,
        });
        return createStateStore(options);
      },
    });

    await engine.load();

    expect(calls).toEqual([{ projectDir, configPath, scope: "project" }]);

    const state = createStateStore({ projectDir, scope: "provided" });
    const engineWithState = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
      state,
      stateFactory: () => {
        throw new Error("stateFactory should not be called when state is provided");
      },
    });

    await engineWithState.load();
    expect(engineWithState.listNodeRuns()).toEqual([]);
  });

  test("invalidates task cache when handler source changes", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-handler-cache-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });
    const writeConfig = (projectDir: string, value: string) =>
      writeStokeIndex(
        projectDir,
        `
          import { workflow } from "${import.meta.dir}/index.ts";

          const app = workflow("handler-cache");

          export const root = app.sequence("root").task("value", async () => {
            return { ctx: { value: "${value}" } };
          });
        `,
      );

    const firstConfigPath = writeConfig(firstProjectDir, "one");
    const secondConfigPath = writeConfig(secondProjectDir, "two");

    const first = await createDevMachineEngine({
      projectDir: firstProjectDir,
      configPath: firstConfigPath,
      state,
    });
    await first.load();
    const applied = await first.apply({ workflow: "handler-cache" });
    expect(applied.context.value).toBe("one");

    const cached = await first.plan({ workflow: "handler-cache" });
    expect(cached.cachedNodeCount).toBe(1);

    const second = await createDevMachineEngine({
      projectDir: secondProjectDir,
      configPath: secondConfigPath,
      state,
    });
    await second.load();
    const changed = await second.plan({ workflow: "handler-cache" });
    expect(changed.cachedNodeCount).toBe(0);
    expect(changed.nodes[0]?.status).toBe("pending");

    const reapplied = await second.apply({ workflow: "handler-cache" });
    expect(reapplied.context.value).toBe("two");
    expect(second.listNodeRuns()).toHaveLength(2);
  });

  test("invalidates task cache when closed-over config source changes", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-closed-over-cache-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });
    const writeConfig = (projectDir: string, value: string) =>
      writeStokeIndex(
        projectDir,
        `
          import { workflow } from "${import.meta.dir}/index.ts";

          const value = "${value}";
          const app = workflow("closed-over-cache");

          export const root = app.sequence("root").task("value", async () => {
            return { ctx: { value } };
          });
        `,
      );

    writeConfig(firstProjectDir, "one");
    writeConfig(secondProjectDir, "two");
    const first = await createDevMachineEngine({
      projectDir: firstProjectDir,
      state,
    });
    await first.load();
    const applied = await first.apply({ workflow: "closed-over-cache" });
    expect(applied.context.value).toBe("one");
    expect((await first.plan({ workflow: "closed-over-cache" })).cachedNodeCount).toBe(1);

    const second = await createDevMachineEngine({
      projectDir: secondProjectDir,
      state,
    });
    await second.load();
    const changed = await second.plan({ workflow: "closed-over-cache" });
    expect(changed.cachedNodeCount).toBe(0);

    const reapplied = await second.apply({ workflow: "closed-over-cache" });
    expect(reapplied.context.value).toBe("two");
  });

  test("keeps upstream task cache when adding a new downstream task", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-insert-task-cache-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });
    const writeConfig = (projectDir: string, includeExtra: boolean) =>
      writeStokeIndex(
        projectDir,
        `
          import { workflow } from "${import.meta.dir}/index.ts";

          const app = workflow("insert-task-cache");

          export const root = app.sequence("root")
            .task("base", async () => ({ ctx: { base: true } }))
            ${includeExtra ? '.task("extra", async ({ step }) => ({ ctx: { ...step.ctx, extra: true } }))' : ""};
        `,
      );

    writeConfig(firstProjectDir, false);
    writeConfig(secondProjectDir, true);

    const first = await createDevMachineEngine({
      projectDir: firstProjectDir,
      state,
    });
    await first.load();
    const applied = await first.apply({ workflow: "insert-task-cache" });
    expect(applied.context.base).toBe(true);
    expect((await first.plan({ workflow: "insert-task-cache" })).cachedNodeCount).toBe(1);

    const second = await createDevMachineEngine({
      projectDir: secondProjectDir,
      state,
    });
    await second.load();
    const changed = await second.plan({ workflow: "insert-task-cache" });
    expect(changed.nodes.map((node) => node.status)).toEqual(["cached", "pending"]);
    expect(changed.cachedNodeCount).toBe(1);

    const reapplied = await second.apply({ workflow: "insert-task-cache" });
    expect(reapplied.context).toEqual({ base: true, extra: true });
  });

  test("keeps upstream task cache when only the final task changes", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-final-task-cache-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });
    const writeConfig = (projectDir: string, finalValue: string) =>
      writeStokeIndex(
        projectDir,
        `
          import { workflow } from "${import.meta.dir}/index.ts";

          const app = workflow("final-task-cache");

          export const root = app.sequence("root")
            .task("first", async () => ({ ctx: { first: true } }))
            .task("second", async ({ step }) => ({ ctx: { ...step.ctx, second: true } }))
            .task("final", async ({ step }) => ({ ctx: { ...step.ctx, final: "${finalValue}" } }));
        `,
      );

    writeConfig(firstProjectDir, "one");
    writeConfig(secondProjectDir, "two");

    const first = await createDevMachineEngine({ projectDir: firstProjectDir, state });
    await first.load();
    await first.apply({ workflow: "final-task-cache" });

    const second = await createDevMachineEngine({ projectDir: secondProjectDir, state });
    await second.load();
    const changed = await second.plan({ workflow: "final-task-cache" });

    expect(changed.nodes.map((node) => node.status)).toEqual(["cached", "cached", "pending"]);
    expect(changed.cachedNodeCount).toBe(2);
  });

  test("keeps upstream task cache when formatting changes with the final task", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-formatted-final-task-cache-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });

    writeStokeIndex(
      firstProjectDir,
      `
        import { workflow } from "${import.meta.dir}/index.ts";
        const merge = (ctx: Record<string, unknown>, value: string) => ({ ...ctx, value });
        const app = workflow("formatted-final-task-cache");
        export const root = app.sequence("root")
          .task("first", async () => ({ ctx: { first: true, label: "same" } }))
          .task("second", async ({ step }) => ({ ctx: merge(step.ctx, "second") }))
          .task("final", async ({ step }) => ({ ctx: { ...step.ctx, final: "one" } }));
      `,
    );
    writeStokeIndex(
      secondProjectDir,
      `
        import { workflow } from "${import.meta.dir}/index.ts";

        const merge = (
          ctx: Record<string, unknown>,
          value: string,
        ) => ({
          ...ctx,
          value,
        });

        const app = workflow("formatted-final-task-cache");

        export const root = app
          .sequence("root")
          .task(
            "first",
            async () => ({
              ctx: {
                first: true,
                label:
                  "same",
              },
            }),
          )
          .task(
            "second",
            async ({ step }) => ({
              ctx: merge(step.ctx, "second"),
            }),
          )
          .task(
            "final",
            async ({ step }) => ({
              ctx: { ...step.ctx, final: "two" },
            }),
          );
      `,
    );

    const first = await createDevMachineEngine({ projectDir: firstProjectDir, state });
    await first.load();
    await first.apply({ workflow: "formatted-final-task-cache" });

    const second = await createDevMachineEngine({ projectDir: secondProjectDir, state });
    await second.load();
    const changed = await second.plan({ workflow: "formatted-final-task-cache" });

    expect(changed.nodes.map((node) => node.status)).toEqual(["cached", "cached", "pending"]);
    expect(changed.cachedNodeCount).toBe(2);
  });

  test("invalidates task cache when task version changes", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-task-version-cache-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });
    const previous = process.env.STOKE_TASK_VERSION;
    const writeConfig = (projectDir: string) => writeStokeIndex(projectDir,
      `
        import { workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("task-version-cache");

        export const root = app.sequence("root").task(
          "value",
          { version: process.env.STOKE_TASK_VERSION },
          async () => ({ ctx: { value: process.env.STOKE_TASK_VERSION } }),
        );
      `,
    );
    writeConfig(firstProjectDir);
    writeConfig(secondProjectDir);

    try {
      process.env.STOKE_TASK_VERSION = "one";
      const first = await createDevMachineEngine({
        projectDir: firstProjectDir,
        state,
      });
      await first.load();
      const applied = await first.apply({ workflow: "task-version-cache" });
      expect(applied.context.value).toBe("one");
      expect((await first.plan({ workflow: "task-version-cache" })).cachedNodeCount).toBe(1);

      process.env.STOKE_TASK_VERSION = "two";
      const second = await createDevMachineEngine({
        projectDir: secondProjectDir,
        state,
      });
      await second.load();
      const changed = await second.plan({ workflow: "task-version-cache" });
      expect(changed.cachedNodeCount).toBe(0);

      const reapplied = await second.apply({ workflow: "task-version-cache" });
      expect(reapplied.context.value).toBe("two");
    } finally {
      restoreEnv("STOKE_TASK_VERSION", previous);
    }
  });

  test("stores globally scoped sequence runs in fragment state and busts downstream local cache", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-global-fragment-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const managedState = createScopedTestState(rootDir);

    const writeConfig = (projectDir: string, value: string) =>
      writeStokeIndex(
        projectDir,
        `
          import { sequence } from "${import.meta.dir}/index.ts";

          const deps = sequence("deps")
            .configure({ value: "${value}" })
            .task("prepare", async ({ config }) => ({ ctx: { value: String(config.value) } }))
            .global();

          export const site = sequence("site")
            .add(deps)
            .task("install", async ({ step }) => ({ ctx: { installed: step.ctx.value } }));
        `,
      );

    const firstConfigPath = writeConfig(firstProjectDir, "one");
    const secondConfigPath = writeConfig(secondProjectDir, "two");

    const engineOptions = (projectDir: string, configPath: string) => ({
      projectDir,
      configPath,
      state: managedState.project,
      stateFactory: managedState.stateFactory,
    });

    const first = await createDevMachineEngine(engineOptions(firstProjectDir, firstConfigPath));
    await first.load();
    await first.apply({ workflow: "site" });
    expect((await first.plan({ workflow: "site" })).cachedNodeCount).toBe(2);
    expect(first.listNodeRuns().map((run) => run.nodePath)).toEqual(["install"]);

    const fragmentStates = [...managedState.scopes.entries()].filter(([scope]) => scope.startsWith("fragment:"));
    expect(fragmentStates).toHaveLength(1);
    expect(fragmentStates[0]![1].listNodeRuns().map((run) => run.nodePath)).toEqual(["deps.prepare"]);

    const cache = await first.listCache();
    expect(cache.entries.map((entry) => entry.scope).sort()).toEqual(["global", "local"]);

    const second = await createDevMachineEngine(engineOptions(secondProjectDir, secondConfigPath));
    await second.load();
    const changed = await second.plan({ workflow: "site" });
    expect(changed.cachedNodeCount).toBe(0);

    const reapplied = await second.apply({ workflow: "site" });
    expect(reapplied.context.installed).toBe("two");
    expect([...managedState.scopes.keys()].filter((scope) => scope.startsWith("fragment:"))).toHaveLength(2);
  });

  test("lists cache entries in workflow plan order", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-cache-order-"));

    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

        export const ordered = sequence("ordered")
          .task("first", async () => {
            await wait();
            return { ctx: { first: true } };
          })
          .task("second", async ({ step }) => {
            await wait();
            return { ctx: { ...step.ctx, second: true } };
          });
      `,
    );

    const engine = await createDevMachineEngine({ projectDir });
    await engine.load();
    await engine.apply({ workflow: "ordered" });

    const plan = await engine.plan({ workflow: "ordered" });
    const cache = await engine.listCache({ workflow: "ordered" });

    expect(cache.entries.map((entry) => entry.displayPath)).toEqual(plan.nodes.map((node) => node.path));
    expect(cache.entries.map((entry) => entry.planIndex)).toEqual([0, 1]);
    expect(cache.entries.map((entry) => entry.nodeName)).toEqual(["first", "second"]);
  });

  test("explains cached and changed task cache decisions", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "stoke-cache-explain-"));
    const firstProjectDir = join(rootDir, "one");
    const secondProjectDir = join(rootDir, "two");
    const state = createStateStore({ projectDir: rootDir });
    const writeConfig = (projectDir: string, value: string) =>
      writeStokeIndex(
        projectDir,
        `
          import { sequence } from "${import.meta.dir}/index.ts";

          export const explain = sequence("explain")
            .task("value", async () => ({ ctx: { value: "${value}" } }));
        `,
      );

    const firstConfigPath = writeConfig(firstProjectDir, "one");
    const first = await createDevMachineEngine({ projectDir: firstProjectDir, configPath: firstConfigPath, state });
    await first.load();
    await first.apply({ workflow: "explain" });

    const cached = await first.explainCache({ workflow: "explain" });
    expect(cached.explanations[0]).toMatchObject({
      path: "value",
      status: "cached",
      reason: { code: "cached" },
    });

    const secondConfigPath = writeConfig(secondProjectDir, "two");
    const second = await createDevMachineEngine({ projectDir: secondProjectDir, configPath: secondConfigPath, state });
    await second.load();

    const changed = await second.explainCache({ workflow: "explain", task: "value" });
    expect(changed.explanations).toHaveLength(1);
    expect(changed.explanations[0]).toMatchObject({
      path: "value",
      status: "pending",
      reason: { code: "task-changed" },
      candidates: [{ reasons: [{ code: "task-changed" }] }],
    });
  });

  test("invalidates global cache entries by plan display path", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-global-cache-invalidate-"));
    const managedState = createScopedTestState(projectDir);

    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        const deps = sequence("deps")
          .task("prepare", async () => ({ ctx: { prepared: true } }))
          .global();

        export const site = sequence("site")
          .add(deps)
          .task("install", async ({ step }) => ({ ctx: { installed: step.ctx.prepared } }));
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      state: managedState.project,
      stateFactory: managedState.stateFactory,
    });
    await engine.load();
    await engine.apply({ workflow: "site" });

    const cache = await engine.listCache({ workflow: "site" });
    expect(cache.entries.find((entry) => entry.scope === "global")?.displayPath).toBe("deps.prepare");

    const result = await engine.invalidateCache({ workflow: "site", nodePaths: ["deps.prepare"] });
    expect(result.invalidated).toBe(1);

    const entries = (await engine.listCache({ workflow: "site", includeUnreachable: true })).entries;
    expect(entries.find((entry) => entry.scope === "global" && entry.nodePath === "deps.prepare")?.invalidated).toBe(true);
  });

  test("allows a later local task to invalidate an earlier global fragment task", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-global-invalidates-"));
    const managedState = createScopedTestState(projectDir);

    const previous = {
      installCount: process.env.STOKE_GLOBAL_INSTALL_COUNT,
      authCount: process.env.STOKE_GLOBAL_AUTH_COUNT,
      repoCount: process.env.STOKE_LOCAL_REPO_COUNT,
      checkCount: process.env.STOKE_LOCAL_CHECK_COUNT,
      forceReauth: process.env.STOKE_FORCE_GLOBAL_REAUTH,
    };
    process.env.STOKE_GLOBAL_INSTALL_COUNT = "0";
    process.env.STOKE_GLOBAL_AUTH_COUNT = "0";
    process.env.STOKE_LOCAL_REPO_COUNT = "0";
    process.env.STOKE_LOCAL_CHECK_COUNT = "0";
    process.env.STOKE_FORCE_GLOBAL_REAUTH = "0";

    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        const base = sequence("base")
          .task("install", async () => {
            const count = Number(process.env.STOKE_GLOBAL_INSTALL_COUNT ?? "0") + 1;
            process.env.STOKE_GLOBAL_INSTALL_COUNT = String(count);
            return { ctx: { installed: "install-" + count } };
          })
          .task("auth", async ({ step }) => {
            const count = Number(process.env.STOKE_GLOBAL_AUTH_COUNT ?? "0") + 1;
            process.env.STOKE_GLOBAL_AUTH_COUNT = String(count);
            return { ctx: { ...step.ctx, token: "token-" + count } };
          })
          .global();

        const repo = sequence("repo")
          .task("clone", async ({ step }) => {
            const count = Number(process.env.STOKE_LOCAL_REPO_COUNT ?? "0") + 1;
            process.env.STOKE_LOCAL_REPO_COUNT = String(count);
            return { ctx: { ...step.ctx, repoToken: step.ctx.token, repoCount: count } };
          });

        export const root = sequence("root")
          .add(base)
          .add(repo)
          .task("check-auth", { cacheTTL: 0 }, async ({ step }) => {
            const count = Number(process.env.STOKE_LOCAL_CHECK_COUNT ?? "0") + 1;
            process.env.STOKE_LOCAL_CHECK_COUNT = String(count);
            if (process.env.STOKE_FORCE_GLOBAL_REAUTH === "1") {
              process.env.STOKE_FORCE_GLOBAL_REAUTH = "0";
              return step.invalidate("auth");
            }
            return { ctx: step.ctx };
          });
      `,
    );

    try {
      const engine = await createDevMachineEngine({
        projectDir,
        state: managedState.project,
        stateFactory: managedState.stateFactory,
      });
      await engine.load();

      const first = await engine.apply({ workflow: "root" });
      expect(first.context.token).toBe("token-1");
      expect(first.context.repoToken).toBe("token-1");
      expect(process.env.STOKE_GLOBAL_INSTALL_COUNT).toBe("1");
      expect(process.env.STOKE_GLOBAL_AUTH_COUNT).toBe("1");
      expect(process.env.STOKE_LOCAL_REPO_COUNT).toBe("1");
      expect(process.env.STOKE_LOCAL_CHECK_COUNT).toBe("1");

      process.env.STOKE_FORCE_GLOBAL_REAUTH = "1";
      const second = await engine.apply({ workflow: "root" });
      expect(second.context.token).toBe("token-2");
      expect(second.context.repoToken).toBe("token-2");
      expect(process.env.STOKE_GLOBAL_INSTALL_COUNT).toBe("1");
      expect(process.env.STOKE_GLOBAL_AUTH_COUNT).toBe("2");
      expect(process.env.STOKE_LOCAL_REPO_COUNT).toBe("2");
      expect(process.env.STOKE_LOCAL_CHECK_COUNT).toBe("3");
      expect([...managedState.scopes.keys()].filter((scope) => scope.startsWith("fragment:"))).toHaveLength(1);
    } finally {
      restoreEnv("STOKE_GLOBAL_INSTALL_COUNT", previous.installCount);
      restoreEnv("STOKE_GLOBAL_AUTH_COUNT", previous.authCount);
      restoreEnv("STOKE_LOCAL_REPO_COUNT", previous.repoCount);
      restoreEnv("STOKE_LOCAL_CHECK_COUNT", previous.checkCount);
      restoreEnv("STOKE_FORCE_GLOBAL_REAUTH", previous.forceReauth);
    }
  });

  test("stores provider JSON state in Stoke-owned provider storage", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    const state = createStateStore({ projectDir });
    const plugin: BaseProviderPlugin = {
      providerId: "test",
      createProvider({ storage }) {
        storage.set("ready", { value: "provider" });
        return new FakeWorkflowProvider();
      },
    };

    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("provider-storage");

        export const root = app.sequence("root")
          .addProvider("test", defineProvider("test", {}))
          .task("ready", async () => ({ ctx: { ready: true } }));
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      state,
      providers: [plugin],
    });

    await engine.load();
    await engine.plan({ workflow: "provider-storage" });

    expect(state.providerStorage("test").get("ready")?.value).toEqual({ value: "provider" });
    expect(state.exportSnapshot().providerState).toHaveLength(1);
  });

  test("stores provider host JSON state outside project state", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    const state = createStateStore({ projectDir });
    const hostStorageDir = join(projectDir, ".host-storage");
    const opened: string[] = [];
    const plugin: BaseProviderPlugin = {
      providerId: "test",
      async createProvider({ storage, hostStorage, local }) {
        storage.set("project", { value: "state" });
        hostStorage.set("token", { value: "secret" });
        await local.open("stoke://provider-auth");
        return new FakeWorkflowProvider();
      },
    };

    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("provider-host-storage");

        export const root = app.sequence("root")
          .addProvider("test", defineProvider("test", {}))
          .task("ready", async () => ({ ctx: { ready: true } }));
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      state,
      hostStorageDir,
      providers: [plugin],
      local: {
        open: async (target) => {
          opened.push(target);
        },
      },
    });

    await engine.load();
    await engine.plan({ workflow: "provider-host-storage" });

    expect(opened).toEqual(["stoke://provider-auth"]);

    const files = readdirSync(hostStorageDir);
    expect(files).toHaveLength(1);
    const hostState = JSON.parse(readFileSync(join(hostStorageDir, files[0]!), "utf8"));
    expect(hostState.records.token.value.value).toBe("secret");

    expect(state.providerStorage("test").get("project")?.value).toEqual({ value: "state" });
    expect(state.providerStorage("test").get("token")).toBeUndefined();
  });

  test("includes provider checks in workflow plans", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-provider-status-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("provider-status");

        export const noop = app.sequence("provider-status")
          .addProvider("test", defineProvider("test", {}))
          .task("noop", async () => {});
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider({
        check: {
          id: "account",
          label: "Test account",
          status: "ok",
          value: "acct-1",
          fingerprint: "acct-1",
          metadata: { accountId: "acct-1" },
        },
      }),
    });
    await engine.load();

    expect((await engine.plan({ workflow: "provider-status" })).providerChecks).toEqual([{
      providerId: "test",
      providerName: "test",
      id: "account",
      label: "Test account",
      status: "ok",
      value: "acct-1",
      fingerprint: "acct-1",
      metadata: { accountId: "acct-1" },
    }]);
  });

  test("requires provider checks before applying workflow tasks", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-provider-check-required-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("provider-check-required");

        export const noop = app.sequence("provider-check-required")
          .addProvider("test", defineProvider("test", {}))
          .task("noop", async () => {});
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider({
        check: {
          id: "auth",
          label: "Test auth",
          status: "required",
          value: "login required",
          message: "Run the provider auth flow.",
          fingerprint: "missing",
        },
      }),
    });
    await engine.load();

    expect((await engine.plan({ workflow: "provider-check-required" })).providerChecks?.[0]).toMatchObject({
      label: "Test auth",
      status: "required",
    });
    await expect(engine.apply({ workflow: "provider-check-required" })).rejects.toThrow(
      "Provider check required: Test auth. Run the provider auth flow.",
    );
  });

  test("rejects task outputs that are not JSON serializable", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test");

        export const bad = app.sequence("bad").task("returns-function", async () => {
          return { ctx: { fn: () => "nope" } };
        });
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
    });

    await engine.load();
    await expect(engine.apply({ workflow: "test" })).rejects.toThrow("must be JSON-serializable");
  });

  test("routes terminal interactions through provider runtimes", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test");

        export const auth = app.sequence("auth")
          .addProvider("test", defineProvider("test", { token: "test-key" }))
          .task("login", async ({ providers }) => {
          const result = await providers.test.openTerminal("GitHub auth", "gh auth login");
          return { ctx: { finished: result.finished } };
        });
      `,
    );

    const interactions: InteractionPresentationRequest[] = [];
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => new FakeWorkflowProvider(),
      interaction: {
        present: async (request) => {
          interactions.push(request);
        },
      },
    });

    await engine.load();
    const applied = await engine.apply({ workflow: "test" });

    expect(interactions).toEqual([
      {
        nodePath: "login",
        id: "fake-terminal",
        title: "GitHub auth",
        url: "http://127.0.0.1/fake-terminal",
        instructions: undefined,
      },
    ]);
    expect(applied.context.finished).toBe(true);
  });

  test("waits for provider-owned interaction completion before resuming tasks", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test");

        export const auth = app.sequence("auth")
          .addProvider("test", defineProvider("test", { token: "test-key" }))
          .task("login", async ({ providers }) => {
          const result = await providers.test.openTerminal("GitHub auth", "gh auth login");
          return { ctx: { finished: result.finished } };
        });
      `,
    );

    let complete!: (result: { finished: true }) => void;
    const completed = new Promise<{ finished: true }>((resolve) => {
      complete = resolve;
    });
    const provider = new FakeWorkflowProvider({
      terminalCompleted: completed,
    });
    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: () => provider,
      interaction: {
        present: async () => {},
      },
    });

    await engine.load();
    let applied: Awaited<ReturnType<typeof engine.apply>> | undefined;
    const applying = engine.apply({ workflow: "test" }).then((result) => {
      applied = result;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(applied).toBeUndefined();
    expect(provider.terminalStopped).toBe(0);

    complete({ finished: true });
    await applying;

    expect(applied?.context.finished).toBe(true);
    expect(provider.terminalStopped).toBe(1);
  });

  test("provider config contributes to the scoped task cache fingerprint", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    const state = createStateStore({ projectDir });
    const previousToken = process.env.STOKE_TEST_PROVIDER_TOKEN;
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test");

        export const setup = app.sequence("setup")
          .addProvider("test", defineProvider("test", { token: () => process.env.STOKE_TEST_PROVIDER_TOKEN }))
          .task("touch", async ({ providers }) => {
          const vm = await providers.test.createVm();
          await vm.exec("touch /tmp/setup", { name: "touch setup" });
          return { ctx: { vm: await vm.snapshotRef() } };
        });
      `,
    );

    try {
      const provider = new FakeWorkflowProvider();
      process.env.STOKE_TEST_PROVIDER_TOKEN = "one";
      const first = await createDevMachineEngine({
        projectDir,
        state,
        providerFactory: () => provider,
      });
      await first.load();
      await first.apply({ workflow: "test" });
      expect((await first.plan({ workflow: "test" })).cachedNodeCount).toBe(1);

      process.env.STOKE_TEST_PROVIDER_TOKEN = "two";
      const second = await createDevMachineEngine({
        projectDir,
        state,
        providerFactory: () => provider,
      });
      await second.load();
      expect((await second.plan({ workflow: "test" })).cachedNodeCount).toBe(0);
    } finally {
      if (previousToken === undefined) {
        delete process.env.STOKE_TEST_PROVIDER_TOKEN;
      } else {
        process.env.STOKE_TEST_PROVIDER_TOKEN = previousToken;
      }
    }
  });

  test("provider config changes only invalidate tasks after addProvider", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-scoped-provider-cache-"));
    const state = createStateStore({ projectDir });
    const previousToken = process.env.STOKE_TEST_PROVIDER_TOKEN;
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("scoped-provider-cache");

        export const setup = app.sequence("setup")
          .task("pure-before", async () => ({ ctx: { before: true } }))
          .addProvider("test", defineProvider("test", { token: () => process.env.STOKE_TEST_PROVIDER_TOKEN }))
          .task("uses-provider", async ({ providers, step }) => {
            const vm = await providers.test.createVm();
            await vm.exec("touch /tmp/scoped", { name: "touch scoped" });
            return { ctx: { ...step.ctx, vm: await vm.snapshotRef() } };
          })
          .task("after-provider", async ({ step }) => ({ ctx: { ...step.ctx, after: true } }));
      `,
    );

    try {
      const provider = new FakeWorkflowProvider();
      process.env.STOKE_TEST_PROVIDER_TOKEN = "one";
      const first = await createDevMachineEngine({
        projectDir,
        state,
        providerFactory: () => provider,
      });
      await first.load();
      await first.apply({ workflow: "scoped-provider-cache" });
      expect((await first.plan({ workflow: "scoped-provider-cache" })).cachedNodeCount).toBe(3);

      process.env.STOKE_TEST_PROVIDER_TOKEN = "two";
      const second = await createDevMachineEngine({
        projectDir,
        state,
        providerFactory: () => provider,
      });
      await second.load();
      const changed = await second.plan({ workflow: "scoped-provider-cache" });
      expect(changed.nodes.map((node) => node.status)).toEqual(["cached", "pending", "pending"]);
      expect(changed.cachedNodeCount).toBe(1);
    } finally {
      restoreEnv("STOKE_TEST_PROVIDER_TOKEN", previousToken);
    }
  });

  test("child provider scopes can override parent provider definitions", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-provider-override-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("provider-override");
        const rootProvider = defineProvider("test", { token: "root" });
        const fragmentProvider = defineProvider("test", { token: "fragment" });

        const fragment = app.sequence("fragment")
          .addProvider("test", fragmentProvider)
          .task("fragment-token", async ({ providers, step }) => ({
            ctx: { ...step.ctx, fragmentToken: providers.test.token },
          }));

        export const setup = app.sequence("setup")
          .addProvider("test", rootProvider)
          .task("root-token", async ({ providers }) => ({
            ctx: { rootToken: providers.test.token },
          }))
          .add(fragment)
          .task("after-fragment", async ({ providers, step }) => ({
            ctx: { ...step.ctx, afterToken: providers.test.token },
          }));
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: ({ provider }) => ({
        providerId: provider.providerId,
        runtime: () => ({ token: String(provider.config.token) }),
      }),
    });

    await engine.load();
    const applied = await engine.apply({ workflow: "provider-override" });

    expect(applied.context).toEqual({
      rootToken: "root",
      fragmentToken: "fragment",
      afterToken: "root",
    });
  });

  test("generic fragments can consume providers from the parent chain", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-parent-provider-fragment-"));
    writeStokeIndex(projectDir,
      `
        import { defineProvider, sequence, workflow } from "${import.meta.dir}/index.ts";

        const genericFragment = sequence("generic-fragment")
          .task("read-provider", async ({ providers }) => ({
            ctx: { token: providers.test.token },
          }));

        const app = workflow("parent-provider-fragment");
        const testProvider = defineProvider("test", { token: "parent" });

        export const setup = app.sequence("setup")
          .addProvider("test", testProvider)
          .add(genericFragment);
      `,
    );

    const engine = await createDevMachineEngine({
      projectDir,
      providerFactory: ({ provider }) => ({
        providerId: provider.providerId,
        runtime: () => ({ token: String(provider.config.token) }),
      }),
    });

    await engine.load();
    const applied = await engine.apply({ workflow: "parent-provider-fragment" });

    expect(applied.context).toEqual({ token: "parent" });
  });

  test("providers added only for workspace operations do not affect setup cache", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-operation-provider-cache-"));
    const state = createStateStore({ projectDir });
    const previousToken = process.env.STOKE_TEST_PROVIDER_TOKEN;
    writeStokeIndex(projectDir,
      `
        import { defineProvider, workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("operation-provider-cache");

        export const setup = app.sequence("setup")
          .task("ready", async () => ({ ctx: { ready: true } }))
          .workspace({
            create: async ({ workspace }) => ({ name: workspace.name }),
            remove: async () => {},
          })
          .addProvider("test", defineProvider("test", { token: () => process.env.STOKE_TEST_PROVIDER_TOKEN }))
          .workspaceOperation("touch-provider", {
            run: async ({ providers }) => {
              const vm = await providers.test.createVm();
              return { vmId: vm.vmId };
            },
          });
      `,
    );

    try {
      const provider = new FakeWorkflowProvider();
      process.env.STOKE_TEST_PROVIDER_TOKEN = "one";
      const first = await createDevMachineEngine({
        projectDir,
        state,
        providerFactory: () => provider,
      });
      await first.load();
      await first.apply({ workflow: "operation-provider-cache" });
      expect((await first.plan({ workflow: "operation-provider-cache" })).cachedNodeCount).toBe(1);

      process.env.STOKE_TEST_PROVIDER_TOKEN = "two";
      const second = await createDevMachineEngine({
        projectDir,
        state,
        providerFactory: () => provider,
      });
      await second.load();
      expect((await second.plan({ workflow: "operation-provider-cache" })).cachedNodeCount).toBe(1);
    } finally {
      restoreEnv("STOKE_TEST_PROVIDER_TOKEN", previousToken);
    }
  });

  test("treats cached output schema failures as cache misses", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-"));
    const previousMode = process.env.STOKE_SCHEMA_MODE;
    writeStokeIndex(projectDir,
      `
        import { workflow } from "${import.meta.dir}/index.ts";

        const app = workflow("test");

        const schema = {
          parse(value) {
            if (!value || typeof value !== "object") throw new Error("not an object");
            if (process.env.STOKE_SCHEMA_MODE === "next" && value.next !== true) {
              throw new Error("missing next");
            }
            return value;
          },
        };

        export const schemaWorkflow = app.sequence("schema").task("value", { output: schema }, async () => {
          return process.env.STOKE_SCHEMA_MODE === "next"
            ? { ctx: { value: "ok", next: true } }
            : { ctx: { value: "ok" } };
        });
      `,
    );

    try {
      process.env.STOKE_SCHEMA_MODE = "old";
      const first = await createDevMachineEngine({
        projectDir,
        providerFactory: () => new FakeWorkflowProvider(),
      });
      await first.load();
      await first.apply({ workflow: "test" });
      expect((await first.plan({ workflow: "test" })).cachedNodeCount).toBe(1);

      process.env.STOKE_SCHEMA_MODE = "next";
      const second = await createDevMachineEngine({
        projectDir,
        providerFactory: () => new FakeWorkflowProvider(),
      });
      await second.load();
      const plan = await second.plan({ workflow: "test" });
      expect(plan.cachedNodeCount).toBe(0);
      expect(plan.nodes[0]?.status).toBe("pending");
    } finally {
      if (previousMode === undefined) {
        delete process.env.STOKE_SCHEMA_MODE;
      } else {
        process.env.STOKE_SCHEMA_MODE = previousMode;
      }
    }
  });

  test("expires task cache when cacheTTL has elapsed", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-cache-ttl-"));
    const state = createStateStore({ projectDir });
    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        export const ttl = sequence("ttl").task("daily-check", { cacheTTL: "1d" }, async () => {
          return { ctx: { checked: true } };
        });
      `,
    );

    const engine = await createDevMachineEngine({ projectDir, state });
    await engine.load();
    await engine.apply({ workflow: "ttl" });
    expect((await engine.plan({ workflow: "ttl" })).cachedNodeCount).toBe(1);

    const run = state.listNodeRuns()[0]!;
    state.saveNodeRun({
      ...run,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const expired = await engine.plan({ workflow: "ttl" });
    expect(expired.cachedNodeCount).toBe(0);
    expect(expired.nodes[0]?.status).toBe("pending");
  });

  test("step.invalidate invalidates a previous task and replays from that point", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "stoke-invalidate-"));
    const previous = {
      authCount: process.env.STOKE_AUTH_COUNT,
      checkCount: process.env.STOKE_CHECK_COUNT,
      forceReauth: process.env.STOKE_FORCE_REAUTH,
    };
    process.env.STOKE_AUTH_COUNT = "0";
    process.env.STOKE_CHECK_COUNT = "0";
    process.env.STOKE_FORCE_REAUTH = "0";

    writeStokeIndex(projectDir,
      `
        import { sequence } from "${import.meta.dir}/index.ts";

        export const reauth = sequence("reauth")
          .task("prepare", async () => ({ ctx: { prepared: true } }))
          .task("github-auth", async () => {
            const count = Number(process.env.STOKE_AUTH_COUNT ?? "0") + 1;
            process.env.STOKE_AUTH_COUNT = String(count);
            return { ctx: { token: "token-" + count } };
          })
          .task("check-auth", { cacheTTL: 0 }, async ({ step }) => {
            const count = Number(process.env.STOKE_CHECK_COUNT ?? "0") + 1;
            process.env.STOKE_CHECK_COUNT = String(count);
            if (process.env.STOKE_FORCE_REAUTH === "1") {
              process.env.STOKE_FORCE_REAUTH = "0";
              return step.invalidate("github-auth");
            }
            return { ctx: step.ctx };
          });
      `,
    );

    try {
      const engine = await createDevMachineEngine({ projectDir });
      await engine.load();

      const first = await engine.apply({ workflow: "reauth" });
      expect(first.context.token).toBe("token-1");
      expect(process.env.STOKE_AUTH_COUNT).toBe("1");
      expect(process.env.STOKE_CHECK_COUNT).toBe("1");

      process.env.STOKE_FORCE_REAUTH = "1";
      const second = await engine.apply({ workflow: "reauth" });
      expect(second.context.token).toBe("token-2");
      expect(process.env.STOKE_AUTH_COUNT).toBe("2");
      expect(process.env.STOKE_CHECK_COUNT).toBe("3");

      const validRuns = engine.listNodeRuns().filter((run) => !run.invalidated);
      expect(validRuns.map((run) => run.nodePath).sort()).toEqual(["check-auth", "github-auth", "prepare"]);
    } finally {
      restoreEnv("STOKE_AUTH_COUNT", previous.authCount);
      restoreEnv("STOKE_CHECK_COUNT", previous.checkCount);
      restoreEnv("STOKE_FORCE_REAUTH", previous.forceReauth);
    }
  });
});

type FakeSnapshotRef = {
  provider: "test";
  kind: "vmSnapshot";
  snapshotId: string;
};

type FakeVm = {
  vmId: string;
  exec(command: string, options?: { name?: string }): Promise<ExecResult>;
  probe(command: string, options?: { name?: string }): Promise<ExecResult>;
  exists(path: string): Promise<boolean>;
  snapshotRef(): Promise<FakeSnapshotRef>;
};

type FakeRuntime = {
  createVm(): Promise<FakeVm>;
  fromSnapshot(ref: FakeSnapshotRef): Promise<FakeVm>;
  fromId(vmId: string): FakeVm;
  openTerminal(label: string, command: string): Promise<{ finished: true }>;
};

class FakeWorkflowProvider implements WorkflowProviderController<FakeRuntime> {
  readonly providerId = "test";
  snapshots: FakeSnapshotRef[] = [];
  private nextVm = 1;
  private files = new Map<string, Set<string>>();
  terminalStopped = 0;

  constructor(
    private readonly options: {
      terminalCompleted?: Promise<{ finished: true }>;
      check?: WorkflowProviderCheckResult | WorkflowProviderCheckResult[];
    } = {},
  ) {}

  checks(): WorkflowProviderCheckResult | WorkflowProviderCheckResult[] | undefined {
    return this.options.check;
  }

  runtime(context: ProviderRuntimeContext): FakeRuntime {
    return {
      createVm: async () => this.createVm(context),
      fromSnapshot: async () => this.createVm(context),
      fromId: (vmId) => this.vmRuntime({ vmId }, context),
      openTerminal: async (label, command) => {
        const completed = this.options.terminalCompleted ?? Promise.resolve({ finished: true as const });
        return await context.interaction.present({
          id: "fake-terminal",
          title: label,
          url: "http://127.0.0.1/fake-terminal",
          completed,
          stop: () => {
            this.terminalStopped += 1;
          },
        });
      },
    };
  }

  validateArtifact(ref: JsonValue): boolean {
    return isFakeSnapshotRef(ref);
  }

  hasFile(vmId: string, path: string): boolean {
    return this.files.get(vmId)?.has(path) ?? false;
  }

  private async createVm(context: ProviderRuntimeContext): Promise<FakeVm> {
    const vm = { vmId: `vm-${this.nextVm++}` };
    this.files.set(vm.vmId, new Set());
    context.emit({ type: "vm.created", providerId: "test", vmId: vm.vmId });
    return this.vmRuntime(vm, context);
  }

  private vmRuntime(vm: { vmId: string }, _context: ProviderRuntimeContext): FakeVm {
    return {
      vmId: vm.vmId,
      exec: async (command) => this.exec(vm.vmId, command, true),
      probe: async (command) => this.exec(vm.vmId, command, false),
      exists: async (path) => this.hasFile(vm.vmId, path),
      snapshotRef: async () => this.createSnapshot(vm),
    };
  }

  private exec(vmId: string, command: string, throwOnFailure: boolean): ExecResult {
    const files = this.files.get(vmId)!;
    const touch = /^touch (.+)$/.exec(command);
    if (touch) files.add(touch[1]!);

    const exists = /^test -e (.+)$/.exec(command);
    if (exists) {
      const path = exists[1]!.replace(/^'|'$/g, "");
      return result(files.has(path));
    }

    const output = result(true);
    if (throwOnFailure && !output.ok) throw new Error("command failed");
    return output;
  }

  private createSnapshot(vm: { vmId: string }): FakeSnapshotRef {
    const snapshot = {
      provider: "test" as const,
      kind: "vmSnapshot" as const,
      snapshotId: `snap-${this.snapshots.length + 1}`,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }
}

function result(ok: boolean): ExecResult {
  return { stdout: "", stderr: "", exitCode: ok ? 0 : 1, ok };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function isFakeSnapshotRef(value: unknown): value is FakeSnapshotRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as FakeSnapshotRef).provider === "test" &&
      (value as FakeSnapshotRef).kind === "vmSnapshot" &&
      typeof (value as FakeSnapshotRef).snapshotId === "string",
  );
}
