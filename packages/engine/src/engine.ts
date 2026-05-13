import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isRigkitConfig, isProviderDefinition, isWorkflowNode } from "./authoring.ts";
import { loadDotEnv } from "./env-file.ts";
import { hash } from "./hash.ts";
import {
  createFileProviderHostStorage,
  defaultProviderHostStorageDir,
  type ProviderHostStorageFactory,
} from "./host-storage.ts";
import { RESERVED_WORKFLOW_OPERATION_IDS, STEP_INVALIDATION_KIND } from "./types.ts";
import type {
  BaseProviderPlugin,
  InteractionPresenter,
  InteractionPresentationRequest,
  ProviderFactory,
  ProviderRuntimeContext,
  WorkflowProviderController,
} from "./provider/types.ts";
import {
  createStateStore,
  type SnapshotRecord,
  type StateService,
  type StateServiceFactory,
  type WorkflowNodeRunRecord,
} from "./state.ts";
import type {
  EventHandler,
  JsonObject,
  JsonValue,
  LoadedProviderDefinition,
  LoadedWorkflow,
  LocalWorkspaceRuntime,
  OutputSchema,
  ProviderRuntimeMap,
  WorkflowInputFieldDefinition,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowLogStream,
  WorkflowNodeDefinition,
  WorkflowOperationDefinition,
  WorkflowPlan,
  WorkflowPlanNode,
  WorkflowProviderMap,
  WorkflowStepInvalidation,
  WorkflowTaskCacheTTL,
  WorkflowTaskNode,
  WorkspaceRecord,
  WorkspaceRuntimeRecord,
  WorkflowWorkspaceOperationDefinition,
} from "./types.ts";

export type CreateDevMachineEngineOptions = {
  projectDir?: string;
  configPath?: string;
  statePath?: string;
  state?: StateService;
  providers?: BaseProviderPlugin[];
  providerFactory?: ProviderFactory;
  stateFactory?: StateServiceFactory;
  hostStorageDir?: string;
  hostStorageFactory?: ProviderHostStorageFactory;
  interaction?: {
    present?: InteractionPresenter;
  };
  local?: Partial<LocalWorkspaceRuntime>;
};

export type { InteractionPresenter, InteractionPresentationRequest };

export type EngineLoadResult = {
  workflow: LoadedWorkflow;
  workflows: LoadedWorkflow[];
  projectDir: string;
  configPath: string;
  statePath: string;
};

export type EngineProjectInfo = {
  projectDir: string;
  configPath: string;
  statePath: string;
  workflows: WorkflowSummary[];
  workflow?: WorkflowSummary;
};

export type WorkflowSummary = {
  name: string;
  providers: string[];
  nodes: string[];
  operations: string[];
  createsWorkspace: boolean;
  workspace?: LoadedWorkflow["workspace"];
};

export type EngineOperationSource = "core" | "config";

export type EngineOperationKind = "command" | "workspace-action";

export type EngineOperationCliPosition = {
  name: string;
  index: number;
};

export type EngineOperationCliOption = {
  name: string;
  flag: string;
  aliases?: string[];
  required?: boolean;
  runtime?: boolean;
  type?: "string" | "boolean" | "number";
};

export type EngineOperationCli = {
  positionals?: EngineOperationCliPosition[];
  options?: EngineOperationCliOption[];
};

export type EngineOperationSummary = {
  workflow: string;
  id: string;
  aliases?: readonly string[];
  source?: EngineOperationSource;
  kind?: EngineOperationKind;
  title?: string;
  description?: string;
  createsWorkspace?: boolean;
  inputFields: readonly WorkflowInputFieldDefinition[];
  cli?: EngineOperationCli;
};

export class EngineOperationValidationError extends Error {
  readonly operation: string;

  constructor(input: { operation: string; message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = "EngineOperationValidationError";
    this.operation = input.operation;
  }
}

export class EngineOperationNotFoundError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Unknown operation ${operation}`);
    this.name = "EngineOperationNotFoundError";
    this.operation = operation;
  }
}

type ProviderControllers = Record<string, WorkflowProviderController>;

type EvaluationMode = "plan" | "apply";

type EvaluationState = {
  context: Record<string, JsonValue>;
  upstreamRunIds: string[];
  previousTasks: EvaluationPreviousTask[];
  known: boolean;
  blockedReason?: string;
};

type EvaluationPreviousTask = {
  name: string;
  path: string;
};

type EvaluationResult = EvaluationState & {
  planNodes: WorkflowPlanNode[];
};

type EvaluateNodeInput = {
  workflow: LoadedWorkflow;
  node: WorkflowNodeDefinition<any, any, any>;
  providers: ProviderControllers;
  providerFingerprint: string;
  mode: EvaluationMode;
  state: EvaluationState;
  prefix: string[];
  root: boolean;
  suppressSequenceName?: string;
  planNodes: WorkflowPlanNode[];
  index: { value: number };
};

type RuntimeOperationEntry = {
  readonly summary: EngineOperationSummary;
  readonly run: (input: { workflow?: string; input?: unknown }) => Promise<unknown>;
};

type RuntimeWorkspaceOperationEntry = {
  readonly summary: EngineOperationSummary;
  readonly run: (input: { workspace: string; workflow?: string; input?: unknown }) => Promise<unknown>;
};

class StepInvalidationRestart extends Error {
  readonly workflow: string;
  readonly target: string;
  readonly targetNodePath: string;
  readonly currentNodePath: string;
  readonly invalidatedRunIds: string[];

  constructor(input: {
    workflow: string;
    target: string;
    targetNodePath: string;
    currentNodePath: string;
    invalidatedRunIds: string[];
  }) {
    super(`Task ${input.currentNodePath} invalidated ${input.targetNodePath}`);
    this.name = "StepInvalidationRestart";
    this.workflow = input.workflow;
    this.target = input.target;
    this.targetNodePath = input.targetNodePath;
    this.currentNodePath = input.currentNodePath;
    this.invalidatedRunIds = input.invalidatedRunIds;
  }
}

let configImportCounter = 0;

export class DevMachineEngine {
  private readonly projectDir: string;
  private readonly configPath: string;
  private readonly statePath: string;
  private state: StateService | undefined;
  private providers: BaseProviderPlugin[];
  private readonly providerFactory: ProviderFactory;
  private readonly stateFactory: StateServiceFactory;
  private readonly hostStorageDir: string;
  private readonly hostStorageFactory: ProviderHostStorageFactory;
  private readonly providerHostStorage = new Map<string, ReturnType<ProviderHostStorageFactory>>();
  private readonly interactionPresenter: InteractionPresenter;
  private readonly local: LocalWorkspaceRuntime;
  private readonly handlers = new Set<EventHandler>();
  private workflows = new Map<string, LoadedWorkflow>();

  constructor(options: CreateDevMachineEngineOptions = {}) {
    this.configPath = options.configPath
      ? resolve(options.configPath)
      : join(resolve(options.projectDir ?? process.cwd()), "rig.config.ts");
    this.projectDir = resolve(options.configPath ? dirname(this.configPath) : options.projectDir ?? process.cwd());
    this.statePath = options.state?.path ?? (options.statePath ? resolve(options.statePath) : join(this.projectDir, ".rigkit", "state.sqlite"));
    this.state = options.state;
    this.providers = options.providers ?? [];
    this.providerFactory = options.providerFactory ?? ((input) => this.createProviderFromPlugin(input));
    this.stateFactory = options.stateFactory ?? createStateStore;
    this.hostStorageDir = options.hostStorageDir ? resolve(options.hostStorageDir) : defaultProviderHostStorageDir();
    this.hostStorageFactory = options.hostStorageFactory ?? createFileProviderHostStorage;
    this.interactionPresenter = options.interaction?.present ?? defaultInteractionPresenter;
    this.local = {
      open: options.local?.open ?? openLocalTarget,
      command: options.local?.command ?? runLocalCommand,
      requestCapability: options.local?.requestCapability ?? requestUnsupportedHostCapability,
      requestCapabilitySession: options.local?.requestCapabilitySession ?? requestUnsupportedHostCapabilitySession,
    };
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async load(): Promise<EngineLoadResult> {
    loadDotEnv(this.projectDir);

    if (!existsSync(this.configPath)) {
      throw new Error(
        `No Rigkit config found at ${this.configPath}. Create one with "rig init" or pass --config <file>.`,
      );
    }

    const moduleUrl = pathToFileURL(this.configPath);
    moduleUrl.searchParams.set("t", `${Date.now()}-${configImportCounter++}`);
    const mod = await import(moduleUrl.href);
    const roots = normalizeDefinitions(mod.default ?? mod.workflow);
    const loaded = await Promise.all(roots.map((root) => this.resolveWorkflow(root)));
    const workflow = loaded[0];
    if (!workflow) {
      throw new Error(`rig.config.ts must define at least one workflow`);
    }
    this.providers = mergeProviderPlugins([
      ...this.providers,
      ...roots.flatMap((root) => Object.values(root.workflow.providers as WorkflowProviderMap))
        .map((provider) => provider.plugin)
        .filter(isBaseProviderPlugin),
    ]);
    this.state ??= this.stateFactory({
      projectDir: this.projectDir,
      configPath: this.configPath,
      statePath: this.statePath,
    });
    await this.state.syncSchema();

    this.workflows = new Map(loaded.map((item) => [item.name, item]));
    if (this.workflows.size !== loaded.length) {
      throw new Error(`Workflow names must be unique`);
    }

    for (const item of loaded) {
      this.emit({ type: "definition.loaded", workflow: item.name });
    }

    return {
      workflow,
      workflows: loaded,
      projectDir: this.projectDir,
      configPath: this.configPath,
      statePath: this.getStateService().path,
    };
  }

  listWorkflows(): LoadedWorkflow[] {
    return [...this.workflows.values()];
  }

  listMachines(): LoadedWorkflow[] {
    return this.listWorkflows();
  }

  getProjectInfo(): EngineProjectInfo {
    const workflows = this.listWorkflowSummaries();
    return {
      projectDir: this.projectDir,
      configPath: this.configPath,
      statePath: this.state?.path ?? this.statePath,
      workflows,
      workflow: workflows.length === 1 ? workflows[0] : undefined,
    };
  }

  listWorkflowSummaries(): WorkflowSummary[] {
    return this.listWorkflows().map((workflow) => summarizeWorkflow(workflow));
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.getStateService().listWorkspaces();
  }

  listSnapshots(): SnapshotRecord[] {
    return this.getStateService().listSnapshots();
  }

  listOperations(): EngineOperationSummary[] {
    return this.listConfigOperationSummaries();
  }

  listRuntimeOperations(): EngineOperationSummary[] {
    return this.listRuntimeOperationEntries().map((entry) => entry.summary);
  }

  listRuntimeWorkspaceOperations(): EngineOperationSummary[] {
    return this.listRuntimeWorkspaceOperationEntries().map((entry) => entry.summary);
  }

  private listRuntimeOperationEntries(): RuntimeOperationEntry[] {
    const configOperations = this.listConfigOperationEntries();
    const configOperationIds = new Set(configOperations.map((entry) => entry.summary.id));
    const coreOperations = this.listCoreOperationEntries();
    return [
      ...coreOperations.filter((entry) =>
        !configOperationIds.has(entry.summary.id) &&
        !entry.summary.aliases?.some((alias) => configOperationIds.has(alias))
      ),
      ...configOperations,
    ];
  }

  private listRuntimeWorkspaceOperationEntries(): RuntimeWorkspaceOperationEntry[] {
    const configOperations = this.listConfigWorkspaceOperationEntries();
    const configOperationIds = new Set(configOperations.map((entry) => entry.summary.id));
    const coreOperations = this.listCoreWorkspaceOperationEntries();
    return [
      ...coreOperations.filter((entry) => !configOperationIds.has(entry.summary.id)),
      ...configOperations,
    ];
  }

  private listConfigOperationEntries(): RuntimeOperationEntry[] {
    return this.listConfigOperationSummaries().map((summary) => ({
      summary,
      run: async (input) =>
        await this.runOperation({
          operation: summary.id,
          workflow: input.workflow,
          input: input.input,
        }),
    }));
  }

  private listConfigOperationSummaries(): EngineOperationSummary[] {
    return this.listWorkflows().flatMap((workflow) =>
      workflow.operations.map((operation) => {
        assertAllowedConfigOperationId(operation.id);
        return {
          workflow: workflow.name,
          id: operation.id,
          source: "config" as const,
          title: operation.title,
          description: operation.description,
          inputFields: operation.input?.fields ?? [],
        };
      }),
    );
  }

  private listConfigWorkspaceOperationEntries(): RuntimeWorkspaceOperationEntry[] {
    return this.listWorkflows().flatMap((workflow) =>
      workflow.workspaceOperations.map((operation) => ({
        summary: this.workspaceOperationSummary(workflow, operation),
        run: async (input) => {
          const workspace = this.getStateService().getWorkspace(input.workspace);
          if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);
          if (workspace.workflow !== workflow.name) {
            throw new EngineOperationValidationError({
              operation: operation.id,
              message: `Workspace ${workspace.name} belongs to workflow ${workspace.workflow}, not ${workflow.name}`,
            });
          }
          const providers = await this.createProviders(workflow);
          return await this.runConfigWorkspaceOperation({
            workflow,
            providers,
            workspace,
            operation,
            rawInput: input.input,
          });
        },
      }))
    );
  }

  private listConfigWorkspaceOperationSummaries(): EngineOperationSummary[] {
    return this.listWorkflows().flatMap((workflow) =>
      workflow.workspaceOperations.map((operation) => {
        assertAllowedConfigOperationId(operation.id);
        return this.workspaceOperationSummary(workflow, operation);
      }),
    );
  }

  private workspaceOperationSummary(
    workflow: LoadedWorkflow,
    operation: WorkflowWorkspaceOperationDefinition<any, any, any, any>,
  ): EngineOperationSummary {
    return {
      workflow: workflow.name,
      id: operation.id,
      source: "config" as const,
      kind: "workspace-action" as const,
      title: operation.title,
      description: operation.description,
      inputFields: operation.input?.fields ?? [],
    };
  }

  private listCoreOperationEntries(): RuntimeOperationEntry[] {
    const workflows = this.listWorkflows();
    const hasWorkspaceCreator = workflows.some((workflow) => workflow.workspace);
    const workflowField = stringField({
      name: "workflow",
      required: false,
    });
    const coreOperation = (
      summary: EngineOperationSummary,
      run: RuntimeOperationEntry["run"],
    ): RuntimeOperationEntry => ({ summary, run });

    return [
      coreOperation(
        {
          workflow: "",
          id: "plan",
          source: "core",
          kind: "command",
          title: "Plan",
          description: "Show cached and pending steps",
          inputFields: [workflowField],
          cli: {
            options: [
              { name: "workflow", flag: "--workflow" },
            ],
          },
        },
        async (input) => {
          const parsed = parseCoreOperationInput("plan", input.input);
          return await this.plan({ workflow: optionalStringInput("plan", parsed, "workflow") });
        },
      ),
      coreOperation(
        {
          workflow: "",
          id: "apply",
          source: "core",
          kind: "command",
          title: "Apply",
          description: "Resolve the workflow, running pending nodes",
          inputFields: [
            workflowField,
            booleanField({ name: "dryRun", required: false, defaultValue: false }),
          ],
          cli: {
            options: [
              { name: "workflow", flag: "--workflow" },
              { name: "dryRun", flag: "--dry-run", type: "boolean" },
            ],
          },
        },
        async (input) => {
          const parsed = parseCoreOperationInput("apply", input.input);
          const workflow = optionalStringInput("apply", parsed, "workflow");
          const dryRun = optionalBooleanInput("apply", parsed, "dryRun", false);
          return dryRun
            ? { dryRun: true, plan: await this.plan({ workflow }) }
            : await this.apply({ workflow });
        },
      ),
      ...(hasWorkspaceCreator
        ? [
          coreOperation(
            {
              workflow: "",
              id: "create",
              aliases: ["fork"],
              source: "core",
              kind: "command",
              title: "Create",
              description: "Create a workspace",
              createsWorkspace: true,
              inputFields: [
                workflowField,
                stringField({ name: "name", required: true }),
              ],
              cli: {
                options: [
                  { name: "workflow", flag: "--workflow" },
                  { name: "name", flag: "--name", required: true },
                ],
              },
            },
            async (input) => {
              const parsed = parseCoreOperationInput("create", input.input);
              return await this.createWorkspace({
                workflow: optionalStringInput("create", parsed, "workflow"),
                name: requiredStringInput("create", parsed, "name"),
              });
            },
          ),
        ]
        : []),
    ];
  }

  private listCoreWorkspaceOperationEntries(): RuntimeWorkspaceOperationEntry[] {
    const workflows = this.listWorkflows().filter((workflow) => workflow.workspace);
    if (workflows.length === 0) return [];
    const coreOperation = (
      summary: EngineOperationSummary,
      run: RuntimeWorkspaceOperationEntry["run"],
    ): RuntimeWorkspaceOperationEntry => ({ summary, run });

    return workflows.map((workflow) =>
      coreOperation(
        {
          workflow: workflow.name,
          id: "remove",
          source: "core",
          kind: "workspace-action",
          title: "Remove",
          description: "Remove a workspace",
          inputFields: [],
          cli: {
            options: [
              { name: "yes", flag: "--yes", aliases: ["-y"], type: "boolean", runtime: false },
            ],
          },
        },
        async (input) =>
          await this.removeWorkspace({
            workflow: input.workflow,
            workspace: input.workspace,
          }),
      )
    );
  }

  listNodeRuns(): WorkflowNodeRunRecord[] {
    return this.getStateService().listNodeRuns();
  }

  hasOperation(operationId: string): boolean {
    return this.listWorkflows().some((workflow) => workflow.operations.some((operation) => operation.id === operationId));
  }

  async runRuntimeOperation(input: { operation: string; workflow?: string; input?: unknown }): Promise<unknown> {
    const workspaceTarget = parseWorkspaceOperationId(input.operation);
    if (workspaceTarget) {
      return await this.runWorkspaceOperation({
        workspace: workspaceTarget.workspace,
        operation: workspaceTarget.operation,
        workflow: input.workflow,
        input: input.input,
      });
    }
    const operation = this.findRuntimeOperationEntry(input.operation);
    if (!operation) throw new EngineOperationNotFoundError(input.operation);
    return await operation.run({ workflow: input.workflow, input: input.input });
  }

  async runOperation(input: { operation: string; workflow?: string; input?: unknown }): Promise<unknown> {
    const { workflow, operation } = this.getWorkflowOperation(input.operation, input.workflow);
    const providers = await this.createProviders(workflow);
    const metadata: JsonObject = {};
    const runtime = await this.createTaskRuntime({
      workflow,
      providers,
      nodePath: `operation.${operation.id}`,
      metadata,
    });
    const operationInput = this.resolveOperationInput(workflow, operation, input.input ?? {});
    const result = await operation.run({
      ...runtime,
      input: Object.freeze(operationInput),
      providers: runtime,
      local: this.local,
      workflow: workflow.name,
      step: this.createStepRuntime(workflow.name, `operation.${operation.id}`, metadata),
    });
    if (result !== undefined) assertJsonValue(result, `Operation ${operation.id} result`);
    return result ?? null;
  }

  async runWorkspaceOperation(input: {
    workspace: string;
    operation: string;
    workflow?: string;
    input?: unknown;
  }): Promise<unknown> {
    const workspace = this.getStateService().getWorkspace(input.workspace);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);
    const workflow = this.getWorkflow(input.workflow ?? workspace.workflow);
    if (workspace.workflow !== workflow.name) {
      throw new EngineOperationValidationError({
        operation: input.operation,
        message: `Workspace ${workspace.name} belongs to workflow ${workspace.workflow}, not ${workflow.name}`,
      });
    }

    const core = this.listCoreWorkspaceOperationEntries().find((entry) =>
      entry.summary.workflow === workflow.name && entry.summary.id === input.operation
    );
    if (core) {
      return await core.run({ workspace: workspace.name, workflow: workflow.name, input: input.input });
    }

    const operation = workflow.workspaceOperations.find((item) => item.id === input.operation);
    if (!operation) throw new EngineOperationNotFoundError(`${workspace.name}/${input.operation}`);
    const providers = await this.createProviders(workflow);
    return await this.runConfigWorkspaceOperation({
      workflow,
      providers,
      workspace,
      operation,
      rawInput: input.input,
    });
  }

  async plan(input: { workflow?: string; machine?: string } = {}): Promise<WorkflowPlan> {
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const providers = await this.createProviders(workflow);
    const result = await this.evaluate({
      workflow,
      providers,
      mode: "plan",
    });

    this.emit({
      type: "plan.created",
      workflow: workflow.name,
      cachedNodeCount: result.plan.cachedNodeCount,
      nodeCount: result.plan.nodeCount,
    });

    return result.plan;
  }

  async apply(input: { workflow?: string; machine?: string } = {}): Promise<{
    context: Record<string, JsonValue>;
    snapshotId?: string;
    workspaceSource?: JsonValue;
    plan: WorkflowPlan;
  }> {
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const providers = await this.createProviders(workflow);
    let result: { context: Record<string, JsonValue>; plan: WorkflowPlan } | undefined;
    const maxRestarts = 8;
    for (let attempt = 0; attempt <= maxRestarts; attempt++) {
      try {
        result = await this.evaluate({
          workflow,
          providers,
          mode: "apply",
        });
        break;
      } catch (error) {
        if (!(error instanceof StepInvalidationRestart)) throw error;
        if (attempt === maxRestarts) {
          throw new Error(
            `Task ${error.currentNodePath} repeatedly invalidated ${error.targetNodePath}; stopping after ${maxRestarts + 1} attempts`,
            { cause: error },
          );
        }
      }
    }
    if (!result) throw new Error(`Workflow ${workflow.name} did not produce an apply result`);

    return {
      context: result.context,
      plan: result.plan,
    };
  }

  async fork(input: { workflow?: string; machine?: string; name: string }): Promise<WorkspaceRecord> {
    return await this.createWorkspace(input);
  }

  async createWorkspace(input: { workflow?: string; machine?: string; name: string }): Promise<WorkspaceRecord> {
    if (!input.name) throw new Error(`create requires a workspace name`);
    if (this.getStateService().getWorkspace(input.name)) {
      throw new Error(`Workspace ${input.name} already exists`);
    }

    const applied = await this.apply({ workflow: input.workflow ?? input.machine });
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const providers = await this.createProviders(workflow);
    if (!workflow.workspace) {
      throw new Error(`Workflow ${workflow.name} does not define a workspace`);
    }

    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      workflow: workflow.name,
      workflowCtx: { ...applied.context },
      ctx: {},
      createdAt: now,
      updatedAt: now,
    };

    this.getStateService().saveWorkspace(workspace);
    try {
      await this.runWorkspaceCreate({
        workflow,
        providers,
        workspace,
        context: applied.context,
        name: input.name,
      });
    } catch (error) {
      this.getStateService().deleteWorkspace(workspace.name);
      throw error;
    }
    const ready = this.getStateService().getWorkspace(input.name) ?? workspace;

    this.emit({
      type: "workspace.ready",
      workspaceId: ready.name,
    });

    return ready;
  }

  async deleteWorkspace(input: { workspace: string; workflow?: string; machine?: string }): Promise<WorkspaceRecord> {
    return await this.removeWorkspace(input);
  }

  async removeWorkspace(input: { workspace: string; workflow?: string; machine?: string }): Promise<WorkspaceRecord> {
    const workspace = this.getStateService().getWorkspace(input.workspace);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);

    const workflow = this.getWorkflow(input.workflow ?? input.machine ?? workspace.workflow);
    if (workspace.workflow !== workflow.name) {
      throw new EngineOperationValidationError({
        operation: "remove",
        message: `Workspace ${workspace.name} belongs to workflow ${workspace.workflow}, not ${workflow.name}`,
      });
    }
    if (!workflow.workspace) {
      throw new Error(`Workflow ${workflow.name} does not define a workspace`);
    }
    const providers = await this.createProviders(workflow);
    const metadata: JsonObject = {};
    const runtime = await this.createTaskRuntime({
      workflow,
      providers,
      nodePath: `workspace.${workspace.name}.remove`,
      metadata,
    });
    const draft = cloneWorkspace(workspace);
    const workspaceRuntime = this.createWorkspaceRuntime(draft);

    await workflow.workspace.remove({
      ...runtime,
      workflow: {
        name: workflow.name,
        ctx: Object.freeze({ ...workspace.workflowCtx }),
      },
      workspace: workspaceRuntime,
      providers: runtime,
      local: this.local,
      step: this.createStepRuntime(workflow.name, `workspace.${workspace.name}.remove`, metadata),
    });

    this.getStateService().deleteWorkspace(input.workspace);
    return workspace;
  }

  private async evaluate(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    mode: EvaluationMode;
  }): Promise<{ context: Record<string, JsonValue>; plan: WorkflowPlan }> {
    const providerFingerprint = providerFingerprintFor(input.workflow);
    const planNodes: WorkflowPlanNode[] = [];
    const result = await this.evaluateNode({
      workflow: input.workflow,
      providers: input.providers,
      providerFingerprint,
      mode: input.mode,
      node: input.workflow.root,
      state: {
        context: {},
        upstreamRunIds: [],
        previousTasks: [],
        known: true,
      },
      prefix: [],
      root: true,
      planNodes,
      index: { value: 0 },
    });
    const cachedNodeCount = planNodes.filter((node) => node.status === "cached").length;
    const plan: WorkflowPlan = {
      workflow: input.workflow.name,
      providerFingerprint,
      cachedNodeCount,
      nodeCount: planNodes.length,
      nodes: planNodes,
      finalContext: result.known ? result.context : undefined,
    };

    return {
      context: result.context,
      plan,
    };
  }

  private async evaluateNode(input: EvaluateNodeInput): Promise<EvaluationResult> {
    if (input.node.nodeKind === "task") {
      return await this.evaluateTask(input as EvaluateNodeInput & { node: WorkflowTaskNode<any, any, any> });
    }

    if (input.node.nodeKind === "parallel") {
      return await this.evaluateParallel(input);
    }

    const sequencePrefix = input.root || input.suppressSequenceName === input.node.name
      ? input.prefix
      : [...input.prefix, input.node.name];
    let state = input.state;

    for (const child of sequenceChildren(input.node)) {
      const result = await this.evaluateNode({
        ...input,
        node: child,
        state,
        prefix: sequencePrefix,
        root: false,
      });
      state = {
        context: result.context,
        upstreamRunIds: result.upstreamRunIds,
        previousTasks: result.previousTasks,
        known: result.known,
        blockedReason: result.blockedReason,
      };
    }

    return { ...state, planNodes: input.planNodes };
  }

  private async evaluateParallel(input: EvaluateNodeInput): Promise<EvaluationResult> {
    const branches = parallelBranches(input.node);
    const branchOutputs: Record<string, JsonValue> = {};
    const joinedRunIds: string[] = [];
    let joinedPreviousTasks = [...input.state.previousTasks];
    let known = input.state.known;
    let blockedReason = input.state.blockedReason;

    for (const [branchName, branch] of Object.entries(branches)) {
      if (branchName in input.state.context) {
        throw new Error(`Parallel branch ${branchName} conflicts with an existing context key`);
      }

      const branchState = await this.evaluateNode({
        ...input,
        node: branch,
        state: {
          context: { ...input.state.context },
          upstreamRunIds: [...input.state.upstreamRunIds],
          previousTasks: [...input.state.previousTasks],
          known: input.state.known,
          blockedReason: input.state.blockedReason,
        },
        prefix: [...input.prefix, branchName],
        root: false,
        suppressSequenceName: branchName,
      });

      if (branchState.known) {
        branchOutputs[branchName] = branchState.context;
        joinedRunIds.push(...branchState.upstreamRunIds);
        joinedPreviousTasks = mergePreviousTasks(joinedPreviousTasks, branchState.previousTasks);
      } else {
        known = false;
        blockedReason ??= branchState.blockedReason ?? `depends on ${branchName}`;
      }
    }

    return {
      context: known ? { ...input.state.context, ...branchOutputs } : { ...input.state.context },
      upstreamRunIds: known ? joinedRunIds.sort() : [],
      previousTasks: known ? joinedPreviousTasks : input.state.previousTasks,
      known,
      blockedReason,
      planNodes: input.planNodes,
    };
  }

  private async evaluateTask(input: EvaluateNodeInput & { node: WorkflowTaskNode<any, any, any> }): Promise<EvaluationResult> {
    const nodePath = [...input.prefix, input.node.name].join(".");
    const upstreamRunIds = [...input.state.upstreamRunIds];
    const nodeKey = hash({
      cache: "task-v3",
      kind: "task",
      path: nodePath,
      name: input.node.name,
      version: input.node.options?.version ?? null,
      handler: functionFingerprintFor(input.node.handler),
      output: input.node.options?.output ?? null,
    });
    const planIndex = input.index.value++;

    if (!input.state.known) {
      input.planNodes.push({
        index: planIndex,
        path: nodePath,
        name: input.node.name,
        status: "pending",
        reason: input.state.blockedReason ?? "upstream output is pending",
        upstreamRunIds,
      });
      return {
        context: input.state.context,
        upstreamRunIds: [],
        previousTasks: input.state.previousTasks,
        known: false,
        blockedReason: input.state.blockedReason ?? `depends on ${nodePath}`,
        planNodes: input.planNodes,
      };
    }

    const cached = await this.findReusableTaskRun({
      workflow: input.workflow.name,
      nodePath,
      nodeKey,
      providerFingerprint: input.providerFingerprint,
      upstreamRunIds,
      providers: input.providers,
      outputSchema: input.node.options?.output,
      cacheTTL: input.node.options?.cacheTTL,
    });

    if (cached) {
      const previousTasks = appendPreviousTask(input.state.previousTasks, {
        name: input.node.name,
        path: nodePath,
      });
      this.emit({ type: "node.cached", nodePath, runId: cached.id });
      input.planNodes.push({
        index: planIndex,
        path: nodePath,
        name: input.node.name,
        status: "cached",
        runId: cached.id,
        upstreamRunIds,
      });
      return {
        context: cached.output,
        upstreamRunIds: [cached.id],
        previousTasks,
        known: true,
        planNodes: input.planNodes,
      };
    }

    input.planNodes.push({
      index: planIndex,
      path: nodePath,
      name: input.node.name,
      status: "pending",
      reason: "no reusable node run",
      upstreamRunIds,
    });

    if (input.mode === "plan") {
      return {
        context: input.state.context,
        upstreamRunIds: [],
        previousTasks: input.state.previousTasks,
        known: false,
        blockedReason: `depends on ${nodePath}`,
        planNodes: input.planNodes,
      };
    }

    this.emit({ type: "node.started", nodePath });
    const metadata: JsonObject = {};
    const runtime = await this.createTaskRuntime({
      workflow: input.workflow,
      providers: input.providers,
      nodePath,
      metadata,
    });
    const step = this.createStepRuntime(
      input.workflow.name,
      nodePath,
      metadata,
      input.state.context,
      input.state.previousTasks,
    );
    const result = await input.node.handler({
      ...runtime,
      providers: runtime,
      step,
    });
    if (isStepInvalidation(result)) {
      const invalidatedRunIds = this.getStateService().invalidateNodeRuns({
        workflow: input.workflow.name,
        nodePaths: [result.targetNodePath, nodePath],
      });
      throw new StepInvalidationRestart({
        workflow: input.workflow.name,
        target: result.target,
        targetNodePath: result.targetNodePath,
        currentNodePath: nodePath,
        invalidatedRunIds,
      });
    }
    const output = normalizeTaskOutput(
      nodePath,
      result,
      input.node.options?.output,
      "fresh",
      input.state.context,
    );
    if (!output) {
      throw new Error(`Task ${nodePath} output failed schema validation`);
    }
    const artifacts = collectArtifacts(output);
    const record: WorkflowNodeRunRecord = {
      id: crypto.randomUUID(),
      workflow: input.workflow.name,
      nodePath,
      nodeName: input.node.name,
      nodeKind: input.node.nodeKind,
      nodeKey,
      providerFingerprint: input.providerFingerprint,
      upstreamRunIds,
      output,
      artifacts,
      invalidated: false,
      createdAt: new Date().toISOString(),
      metadata,
    };

    this.getStateService().saveNodeRun(record);
    for (const artifact of artifacts) {
      const providerId = providerIdOf(artifact);
      this.emit({
        type: "artifact.created",
        nodePath,
        providerId: providerId ?? "unknown",
        kind: kindOf(artifact) ?? "artifact",
        ref: artifact,
      });
    }
    this.emit({ type: "node.completed", nodePath, runId: record.id });

    const previousTasks = appendPreviousTask(input.state.previousTasks, {
      name: input.node.name,
      path: nodePath,
    });

    return {
      context: output,
      upstreamRunIds: [record.id],
      previousTasks,
      known: true,
      planNodes: input.planNodes,
    };
  }

  private async findReusableTaskRun(input: {
    workflow: string;
    nodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
    providers: ProviderControllers;
    outputSchema?: OutputSchema;
    cacheTTL?: WorkflowTaskCacheTTL;
  }): Promise<WorkflowNodeRunRecord | undefined> {
    const cached = this.getStateService().findReusableNodeRun(input);
    if (!cached) return undefined;
    if (!isCacheFresh(cached.createdAt, input.cacheTTL)) return undefined;

    const parsed = normalizeTaskOutput(input.nodePath, cached.output, input.outputSchema, "cached");
    if (!parsed) return undefined;

    for (const artifact of cached.artifacts) {
      const providerId = providerIdOf(artifact);
      if (!providerId) return undefined;
      const provider = Object.values(input.providers).find((controller) => controller.providerId === providerId);
      if (provider?.validateArtifact && !await provider.validateArtifact(artifact)) return undefined;
    }

    return {
      ...cached,
      output: parsed,
    };
  }

  private async createTaskRuntime(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    nodePath: string;
    metadata: JsonObject;
  }): Promise<ProviderRuntimeMap<WorkflowProviderMap>> {
    const entries = await Promise.all(
      Object.entries(input.providers).map(async ([name, provider]) => {
        const runtimeContext: ProviderRuntimeContext = {
          workflow: input.workflow.name,
          nodePath: input.nodePath,
          emit: (event) => this.emit(event),
          interaction: {
            present: async (session) => {
              const interactionId = session.id ?? crypto.randomUUID();
              this.emit({
                type: "interaction.awaiting_user",
                nodePath: input.nodePath,
                interactionId,
                label: session.title,
                title: session.title,
                url: session.url,
                instructions: session.instructions,
              });

              try {
                await this.interactionPresenter({
                  id: interactionId,
                  nodePath: input.nodePath,
                  title: session.title,
                  url: session.url,
                  instructions: session.instructions,
                });

                const result = await session.completed;
                this.emit({
                  type: "interaction.completed",
                  nodePath: input.nodePath,
                  interactionId,
                  label: session.title,
                  title: session.title,
                });
                return result;
              } finally {
                await session.stop();
              }
            },
          },
          local: this.local,
          metadata: (metadata) => {
            Object.assign(input.metadata, metadata);
          },
        };
        return [name, await provider.runtime(runtimeContext)] as const;
      }),
    );

    return Object.fromEntries(entries) as ProviderRuntimeMap<WorkflowProviderMap>;
  }

  private async runWorkspaceCreate(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    workspace: WorkspaceRecord;
    context: Record<string, JsonValue>;
    name: string;
  }): Promise<void> {
    if (!input.workflow.workspace) {
      throw new Error(`Workflow ${input.workflow.name} does not define a workspace`);
    }
    const draft = cloneWorkspace(input.workspace);
    const metadata: JsonObject = {};
    const providers = await this.createTaskRuntime({
      workflow: input.workflow,
      providers: input.providers,
      nodePath: `workspace.${input.name}.create`,
      metadata,
    });

    try {
      const data = await input.workflow.workspace.create({
        ...providers,
        workflow: {
          name: input.workflow.name,
          ctx: Object.freeze({ ...input.context }),
        },
        workspace: {
          name: input.name,
        },
        providers,
        local: this.local,
        step: this.createStepRuntime(input.workflow.name, `workspace.${input.name}.create`, metadata),
      });
      assertJsonValue(data, `Workflow ${input.workflow.name} workspace create result`);
      if (!isPlainObject(data)) {
        throw new Error(`Workflow ${input.workflow.name} workspace create result must be an object`);
      }
      draft.ctx = { ...data };
    } finally {
      draft.updatedAt = new Date().toISOString();
      this.getStateService().saveWorkspace(draft);
    }
  }

  private async runConfigWorkspaceOperation(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    workspace: WorkspaceRecord;
    operation: WorkflowWorkspaceOperationDefinition<any, any, any, any>;
    rawInput: unknown;
  }): Promise<unknown> {
    const metadata: JsonObject = {};
    const providers = await this.createTaskRuntime({
      workflow: input.workflow,
      providers: input.providers,
      nodePath: `workspace.${input.workspace.name}.${input.operation.id}`,
      metadata,
    });
    const draft = cloneWorkspace(input.workspace);
    const workspace = this.createWorkspaceRuntime(draft);
    const operationInput = this.resolveOperationInput(input.workflow, input.operation, input.rawInput ?? {});

    const result = await input.operation.run({
      ...providers,
      workflow: {
        name: input.workflow.name,
        ctx: Object.freeze({ ...input.workspace.workflowCtx }),
      },
      input: Object.freeze(operationInput),
      workspace,
      providers,
      local: this.local,
      step: this.createStepRuntime(
        input.workflow.name,
        `workspace.${input.workspace.name}.${input.operation.id}`,
        metadata,
      ),
    });
    if (result !== undefined) assertJsonValue(result, `Workspace operation ${input.operation.id} result`);
    return result ?? null;
  }

  private createWorkspaceRuntime<Data extends object>(draft: WorkspaceRecord): WorkspaceRuntimeRecord<Data> {
    return Object.freeze({
      name: draft.name,
      ctx: Object.freeze({ ...draft.ctx }) as Data,
    }) as WorkspaceRuntimeRecord<Data>;
  }

  private createStepRuntime<Context extends JsonObject = JsonObject>(
    workflow: string,
    nodePath: string,
    metadata: JsonObject,
    context: Context = {} as Context,
    previousTasks: readonly EvaluationPreviousTask[] = [],
  ) {
    return {
      workflow,
      nodePath,
      ctx: Object.freeze({ ...context }) as Readonly<Context>,
      metadata: (value: JsonObject) => {
        Object.assign(metadata, value);
      },
      log: (data: string, options: { stream?: WorkflowLogStream; label?: string } = {}) => {
        this.emit({
          type: "log.output",
          nodePath,
          stream: options.stream ?? "info",
          label: options.label,
          data,
        });
      },
      invalidate: <Target extends string>(target: Target) => {
        const matches = previousTasks.filter((task) => task.name === target || task.path === target);
        if (matches.length === 0) {
          throw new Error(`Task ${nodePath} cannot invalidate ${target} because it has not run earlier in this workflow`);
        }
        if (matches.length > 1) {
          throw new Error(`Task ${nodePath} cannot invalidate ${target} because it matches multiple earlier tasks`);
        }
        return {
          kind: STEP_INVALIDATION_KIND,
          target,
          targetNodePath: matches[0]!.path,
        };
      },
    };
  }

  private getWorkflow(name: string | undefined): LoadedWorkflow {
    if (this.workflows.size === 0) {
      throw new Error(`No workflows loaded. Call engine.load() first.`);
    }

    if (name) {
      const workflow = this.workflows.get(name);
      if (!workflow) throw new Error(`Unknown workflow ${name}`);
      return workflow;
    }

    if (this.workflows.size === 1) return [...this.workflows.values()][0]!;

    throw new Error(`Multiple workflows are defined; pass a workflow name`);
  }

  private findRuntimeOperationEntry(operationId: string): RuntimeOperationEntry | undefined {
    return this.listRuntimeOperationEntries().find((entry) =>
      entry.summary.id === operationId || entry.summary.aliases?.includes(operationId)
    );
  }

  private getWorkflowOperation(operationId: string, workflowName: string | undefined): {
    workflow: LoadedWorkflow;
    operation: WorkflowOperationDefinition<any, any>;
  } {
    const workflows = workflowName ? [this.getWorkflow(workflowName)] : this.listWorkflows();
    const matches = workflows.flatMap((workflow) =>
      workflow.operations
        .filter((operation) => operation.id === operationId)
        .map((operation) => ({ workflow, operation })),
    );
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new Error(`Multiple workflows define operation ${operationId}; pass a workflow name`);
    throw new EngineOperationNotFoundError(operationId);
  }

  private resolveOperationInput(
    workflow: LoadedWorkflow,
    operation: { id: string; input?: { fields: readonly WorkflowInputFieldDefinition[] } },
    value: unknown,
  ): Record<string, unknown> {
    const raw = isPlainObject(value) ? value : {};
    const fields = operation.input?.fields ?? [];
    if (fields.length === 0) return { ...raw };

    const resolved: Record<string, unknown> = {};
    for (const field of fields) {
      const rawValue = raw[field.name] ?? field.defaultValue;
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        if (field.required ?? true) {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Operation ${operation.id} requires ${field.name}`,
          });
        }
        continue;
      }

      if (field.kind === "workspace") {
        if (typeof rawValue !== "string") {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Operation ${operation.id} input ${field.name} must be a workspace name`,
          });
        }
        const workspace = this.getStateService().findWorkspace(rawValue);
        if (!workspace) {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Unknown workspace ${rawValue}`,
          });
        }
        if (workspace.workflow !== workflow.name) {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Workspace ${workspace.name} belongs to workflow ${workspace.workflow}, not ${workflow.name}`,
          });
        }
        resolved[field.name] = this.createWorkspaceRuntime(cloneWorkspace(workspace));
        continue;
      }

      if (field.kind === "string") {
        if (typeof rawValue !== "string") {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Operation ${operation.id} input ${field.name} must be a string`,
          });
        }
        resolved[field.name] = rawValue;
        continue;
      }

      if (field.kind === "boolean") {
        if (typeof rawValue !== "boolean") {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Operation ${operation.id} input ${field.name} must be a boolean`,
          });
        }
        resolved[field.name] = rawValue;
        continue;
      }

      if (field.kind === "number") {
        if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
          throw new EngineOperationValidationError({
            operation: operation.id,
            message: `Operation ${operation.id} input ${field.name} must be a number`,
          });
        }
        resolved[field.name] = rawValue;
      }
    }

    return resolved;
  }

  private getStateService(): StateService {
    if (!this.state) {
      throw new Error(`No state database loaded. Call engine.load() first.`);
    }
    return this.state;
  }

  private async createProviders(workflow: LoadedWorkflow): Promise<ProviderControllers> {
    const entries = await Promise.all(
      Object.entries(workflow.providers).map(async ([name, provider]) => {
        const controller = await this.providerFactory({
          provider,
          storage: this.getStateService().providerStorage(provider.providerId),
          hostStorage: this.getProviderHostStorage(provider.providerId),
          local: this.local,
        });
        return [name, controller] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  private async createProviderFromPlugin(input: Parameters<ProviderFactory>[0]): Promise<WorkflowProviderController> {
    const plugin = this.providers.find((provider) => provider.providerId === input.provider.providerId);
    if (!plugin) {
      throw new Error(
        `Provider ${input.provider.providerId} does not implement the Rigkit workflow provider contract. ` +
          `Register a provider plugin to use it in workflow tasks.`,
      );
    }
    return await plugin.createProvider(input);
  }

  private getProviderHostStorage(providerId: string): ReturnType<ProviderHostStorageFactory> {
    let storage = this.providerHostStorage.get(providerId);
    if (!storage) {
      storage = this.hostStorageFactory({
        providerId,
        rootDir: this.hostStorageDir,
      });
      this.providerHostStorage.set(providerId, storage);
    }
    return storage;
  }

  private async resolveWorkflow(root: WorkflowNodeDefinition<any, any, any>): Promise<LoadedWorkflow> {
    const providers: Record<string, LoadedProviderDefinition> = {};
    for (const [name, definition] of Object.entries(root.workflow.providers)) {
      if (!isProviderDefinition(definition)) {
        throw new Error(`Workflow ${root.workflow.name} provider ${name} is invalid`);
      }
      providers[name] = await resolveProviderDefinition(definition);
    }

    return {
      name: root.workflow.name,
      providers,
      root,
      workspace: root.workspaceDefinition,
      operations: root.operations ?? [],
      workspaceOperations: root.workspaceOperations ?? [],
    };
  }

  private emit(event: WorkflowEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}

export async function createDevMachineEngine(
  options: CreateDevMachineEngineOptions = {},
): Promise<DevMachineEngine> {
  return new DevMachineEngine(options);
}

function cloneWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
  return {
    ...workspace,
    workflowCtx: { ...workspace.workflowCtx },
    ctx: { ...workspace.ctx },
  };
}

function parseWorkspaceOperationId(value: string): { workspace: string; operation: string } | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return {
    workspace: value.slice(0, slash),
    operation: value.slice(slash + 1),
  };
}

async function resolveProviderDefinition(
  definition: WorkflowDefinition<any, any>["providers"][string],
): Promise<LoadedProviderDefinition> {
  return {
    providerId: definition.providerId,
    config: await resolveConfigObject(definition.config),
    plugin: definition.plugin,
  };
}

async function resolveConfigObject(value: unknown): Promise<Record<string, unknown>> {
  const resolved = await resolveConfigValue(value);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`Provider config must resolve to an object`);
  }
  return resolved as Record<string, unknown>;
}

async function resolveConfigValue(value: unknown): Promise<unknown> {
  if (typeof value === "function") {
    return await (value as () => unknown)();
  }

  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => resolveConfigValue(item)));
  }

  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, entry]) => [key, await resolveConfigValue(entry)] as const),
    );
    return Object.fromEntries(entries);
  }

  return value;
}

function normalizeDefinitions(value: unknown): WorkflowNodeDefinition<any, any, any>[] {
  if (isRigkitConfig(value)) {
    return Object.entries(value.workflows).map(([name, node]) =>
      attachWorkflowProviders(name, node, value.providers)
    );
  }

  if (Array.isArray(value)) {
    throw new Error(`rig.config.ts must default export a workflow node or defineConfig(...)`);
  }
  if (!isWorkflowNode(value)) {
    throw new Error(`rig.config.ts must default export a node created with workflow(...).sequence(...) or defineConfig(...)`);
  }
  return [value];
}

function attachWorkflowProviders(
  name: string,
  node: WorkflowNodeDefinition<any, any, any>,
  providers: WorkflowProviderMap,
): WorkflowNodeDefinition<any, any, any> {
  const workflow: WorkflowDefinition<string, any> = {
    ...node.workflow,
    name: node.workflow.name || name,
    providers,
  };
  return attachWorkflow(node, workflow);
}

function attachWorkflow(
  node: WorkflowNodeDefinition<any, any, any>,
  workflow: WorkflowDefinition<string, any>,
): WorkflowNodeDefinition<any, any, any> {
  if (node.nodeKind === "parallel") {
    return {
      ...node,
      workflow,
      branches: Object.fromEntries(
        Object.entries(parallelBranches(node)).map(([name, branch]) => [name, attachWorkflow(branch, workflow)]),
      ),
    } as WorkflowNodeDefinition<any, any, any>;
  }
  if (node.nodeKind === "sequence") {
    return {
      ...node,
      workflow,
      children: sequenceChildren(node).map((child) => attachWorkflow(child, workflow)),
    } as WorkflowNodeDefinition<any, any, any>;
  }
  return {
    ...node,
    workflow,
  };
}

function summarizeWorkflow(workflow: LoadedWorkflow): WorkflowSummary {
  return {
    name: workflow.name,
    providers: Object.entries(workflow.providers).map(([name, provider]) => `${name}:${provider.providerId}`),
    nodes: collectNodePaths(workflow.root),
    operations: workflow.operations.map((operation) => operation.id),
    createsWorkspace: Boolean(workflow.workspace),
    workspace: workflow.workspace,
  };
}

function collectNodePaths(root: WorkflowNodeDefinition<any, any, any>): string[] {
  const paths: string[] = [];
  walk(root, [], true);
  return paths;

  function walk(node: WorkflowNodeDefinition<any, any, any>, prefix: string[], rootNode: boolean, suppress?: string): void {
    if (node.nodeKind === "task") {
      paths.push([...prefix, node.name].join("."));
      return;
    }
    if (node.nodeKind === "parallel") {
      for (const [branchName, branch] of Object.entries(parallelBranches(node))) {
        walk(branch, [...prefix, branchName], false, branchName);
      }
      return;
    }
    const sequencePrefix = rootNode || suppress === node.name ? prefix : [...prefix, node.name];
    for (const child of sequenceChildren(node)) walk(child, sequencePrefix, false);
  }
}

function providerFingerprintFor(workflow: LoadedWorkflow): string {
  return hash({
    cache: "provider-v2",
    providers: Object.fromEntries(
      Object.entries(workflow.providers).map(([name, provider]) => [
        name,
        {
          providerId: provider.providerId,
          config: provider.config,
          plugin: providerPluginFingerprint(provider.plugin),
        },
      ]),
    ),
  });
}

function providerPluginFingerprint(plugin: unknown): unknown {
  if (!isBaseProviderPlugin(plugin)) return null;
  return {
    providerId: plugin.providerId,
    createProvider: functionFingerprintFor(plugin.createProvider),
  };
}

function functionFingerprintFor(fn: Function): { name: string; length: number; source: string } {
  return {
    name: fn.name,
    length: fn.length,
    source: Function.prototype.toString.call(fn),
  };
}

function sequenceChildren(node: WorkflowNodeDefinition<any, any, any>): readonly WorkflowNodeDefinition<any, any, any>[] {
  return (node as { children?: readonly WorkflowNodeDefinition<any, any, any>[] }).children ?? [];
}

function parallelBranches(node: WorkflowNodeDefinition<any, any, any>): Record<string, WorkflowNodeDefinition<any, any, any>> {
  return (node as { branches?: Record<string, WorkflowNodeDefinition<any, any, any>> }).branches ?? {};
}

function appendPreviousTask(
  tasks: readonly EvaluationPreviousTask[],
  task: EvaluationPreviousTask,
): EvaluationPreviousTask[] {
  return mergePreviousTasks([...tasks], [task]);
}

function mergePreviousTasks(
  left: readonly EvaluationPreviousTask[],
  right: readonly EvaluationPreviousTask[],
): EvaluationPreviousTask[] {
  const seen = new Set<string>();
  const result: EvaluationPreviousTask[] = [];
  for (const task of [...left, ...right]) {
    if (seen.has(task.path)) continue;
    seen.add(task.path);
    result.push(task);
  }
  return result;
}

function normalizeTaskOutput(
  nodePath: string,
  result: unknown,
  schema: OutputSchema | undefined,
  source: "fresh" | "cached",
  currentContext: Record<string, JsonValue> = {},
): Record<string, JsonValue> | undefined {
  if (source === "fresh") {
    if (result === undefined) return { ...currentContext };
    if (!isPlainObject(result) || !("ctx" in result)) {
      throw new Error(`Task ${nodePath} must return { ctx: { ... } } or step.invalidate(...)`);
    }
    const ctx = result.ctx;
    const value = schema ? parseWithSchema(schema, ctx, source) : ctx;
    if (!isPlainObject(value)) {
      throw new Error(`Task ${nodePath} ctx must be a JSON-serializable object`);
    }

    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `Task ${nodePath} ctx value ${key}`);
    }

    return value as Record<string, JsonValue>;
  }

  const value = schema ? parseWithSchema(schema, result, source) : result;
  if (value === undefined) return schema ? undefined : {};
  if (!isPlainObject(value)) {
    if (source === "cached") return undefined;
    throw new Error(`Task ${nodePath} cached ctx must be a JSON-serializable object`);
  }

  for (const [key, item] of Object.entries(value)) {
    assertJsonValue(item, `Task ${nodePath} ctx value ${key}`);
  }

  return value as Record<string, JsonValue>;
}

function isCacheFresh(createdAt: string, ttl: WorkflowTaskCacheTTL | undefined): boolean {
  const ttlMs = parseCacheTTL(ttl);
  if (ttlMs === undefined) return true;
  if (ttlMs <= 0) return false;
  const createdTime = Date.parse(createdAt);
  if (Number.isNaN(createdTime)) return false;
  return Date.now() - createdTime <= ttlMs;
}

function parseCacheTTL(ttl: WorkflowTaskCacheTTL | undefined): number | undefined {
  if (ttl === undefined) return undefined;
  if (typeof ttl === "number") {
    assertFiniteTTL(ttl, "cacheTTL");
    return ttl;
  }
  if (typeof ttl === "string") return parseCacheTTLString(ttl);

  const total =
    (ttl.seconds ?? 0) * 1000 +
    (ttl.minutes ?? 0) * 60 * 1000 +
    (ttl.hours ?? 0) * 60 * 60 * 1000 +
    (ttl.days ?? 0) * 24 * 60 * 60 * 1000;
  assertFiniteTTL(total, "cacheTTL");
  return total;
}

function parseCacheTTLString(value: string): number {
  const input = value.trim();
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(`cacheTTL must be a number, an object, or a string like "30m", "6h", or "1d"`);
  }
  const amount = Number(match[1]);
  assertFiniteTTL(amount, "cacheTTL");
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "ms" ? 1
      : unit === "s" ? 1000
      : unit === "m" ? 60 * 1000
      : unit === "h" ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return amount * multiplier;
}

function assertFiniteTTL(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative duration`);
  }
}

function isStepInvalidation(value: unknown): value is WorkflowStepInvalidation<string> {
  return isPlainObject(value) &&
    value.kind === STEP_INVALIDATION_KIND &&
    typeof value.target === "string" &&
    typeof value.targetNodePath === "string";
}

function parseWithSchema(
  schema: OutputSchema,
  value: unknown,
  source: "fresh" | "cached",
): unknown {
  if ("safeParse" in schema && typeof schema.safeParse === "function") {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    if (source === "cached") return undefined;
    throw new Error(`Task output failed schema validation`);
  }

  if ("parse" in schema && typeof schema.parse === "function") {
    try {
      return schema.parse(value);
    } catch (error) {
      if (source === "cached") return undefined;
      throw error;
    }
  }

  return value;
}

function collectArtifacts(value: unknown): JsonValue[] {
  const artifacts: JsonValue[] = [];
  visit(value);
  return artifacts;

  function visit(item: unknown): void {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isPlainObject(item)) return;
    if (typeof item.provider === "string" && typeof item.kind === "string") {
      artifacts.push(item as JsonValue);
    }
    for (const child of Object.values(item)) visit(child);
  }
}

function providerIdOf(value: unknown): string | undefined {
  return isPlainObject(value) && typeof value.provider === "string" ? value.provider : undefined;
}

function kindOf(value: unknown): string | undefined {
  return isPlainObject(value) && typeof value.kind === "string" ? value.kind : undefined;
}

function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`));
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${label}.${key}`);
    }
    return;
  }

  throw new Error(`${label} must be JSON-serializable`);
}

function isJsonValue(value: unknown): value is JsonValue {
  try {
    assertJsonValue(value, "value");
    return true;
  } catch {
    return false;
  }
}

const RESERVED_HOST_OPERATION_IDS = new Set<string>(RESERVED_WORKFLOW_OPERATION_IDS);

const CORE_OPERATION_INPUT_FIELDS: Record<string, readonly string[]> = {
  plan: ["workflow"],
  apply: ["workflow", "dryRun"],
  create: ["workflow", "name"],
  ssh: ["workflow", "workspaceOrVmId", "user", "print"],
  snapshot: ["workflow", "workspace", "label"],
};

function assertAllowedConfigOperationId(operationId: string): void {
  if (!RESERVED_HOST_OPERATION_IDS.has(operationId)) return;
  throw new Error(
    `Config operation "${operationId}" conflicts with a reserved Rigkit host command. ` +
      `Choose a different operation id.`,
  );
}

function stringField(options: {
  name: string;
  description?: string;
  position?: number;
  required?: boolean;
  defaultValue?: string;
}): WorkflowInputFieldDefinition<string> {
  return {
    kind: "string",
    name: options.name,
    description: options.description,
    position: options.position,
    required: options.required,
    defaultValue: options.defaultValue,
  };
}

function booleanField(options: {
  name: string;
  description?: string;
  position?: number;
  required?: boolean;
  defaultValue?: boolean;
}): WorkflowInputFieldDefinition<boolean> {
  return {
    kind: "boolean",
    name: options.name,
    description: options.description,
    position: options.position,
    required: options.required,
    defaultValue: options.defaultValue,
  };
}

function parseCoreOperationInput(operation: string, value: unknown): Record<string, unknown> {
  const raw = value === undefined ? {} : value;
  if (!isPlainObject(raw)) {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} input must be an object`,
    });
  }

  const allowed = new Set(CORE_OPERATION_INPUT_FIELDS[operation] ?? []);
  const excess = Object.keys(raw).find((key) => !allowed.has(key));
  if (excess) {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} does not accept input ${excess}`,
    });
  }

  return raw;
}

function requiredStringInput(operation: string, input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string") {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} requires ${name}`,
    });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} requires ${name}`,
    });
  }
  return trimmed;
}

function optionalStringInput(operation: string, input: Record<string, unknown>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} input ${name} must be a string`,
    });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} input ${name} must be non-empty`,
    });
  }
  return trimmed;
}

function optionalBooleanInput(
  operation: string,
  input: Record<string, unknown>,
  name: string,
  defaultValue: boolean,
): boolean {
  const value = input[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new EngineOperationValidationError({
      operation,
      message: `Operation ${operation} input ${name} must be a boolean`,
    });
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
}

async function openLocalTarget(target: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? ["open", target]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", target]
        : ["xdg-open", target];

  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Failed to open ${target}`);
  }
}

async function requestUnsupportedHostCapability<Result = unknown>(capability: string): Promise<Result> {
  throw new Error(
    `Host capability ${capability} is unavailable outside a runtime host. ` +
      `Run this operation through Rigkit CLI or another host that supports typed host capabilities.`,
  );
}

async function requestUnsupportedHostCapabilitySession<Result = unknown>(
  capability: string,
): Promise<{ result: Result; closed: Promise<void> }> {
  return {
    result: await requestUnsupportedHostCapability<Result>(capability),
    closed: Promise.resolve(),
  };
}

async function runLocalCommand(input: {
  argv: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string | null;
  mode?: "capture" | "interactive";
}): Promise<{ exitCode: number; stdout: string | null; stderr: string | null }> {
  if (input.argv.length === 0) {
    throw new Error(`Local command argv must not be empty`);
  }

  if (input.mode === "interactive") {
    const proc = Bun.spawn(input.argv, {
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } : process.env,
      stdin: input.stdin === undefined || input.stdin === null ? "inherit" : "pipe",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (input.stdin !== undefined && input.stdin !== null) {
      const stdin = proc.stdin;
      if (!stdin) throw new Error(`Local command stdin is unavailable`);
      stdin.write(input.stdin);
      stdin.end();
    }
    return { exitCode: await proc.exited, stdout: null, stderr: null };
  }

  const proc = Bun.spawn(input.argv, {
    cwd: input.cwd,
    env: input.env ? { ...process.env, ...input.env } : process.env,
    stdin: input.stdin === undefined || input.stdin === null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input.stdin !== undefined && input.stdin !== null) {
    const stdin = proc.stdin;
    if (!stdin) throw new Error(`Local command stdin is unavailable`);
    stdin.write(input.stdin);
    stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

function isBaseProviderPlugin(value: unknown): value is BaseProviderPlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as BaseProviderPlugin).providerId === "string" &&
      typeof (value as BaseProviderPlugin).createProvider === "function",
  );
}

function mergeProviderPlugins(plugins: BaseProviderPlugin[]): BaseProviderPlugin[] {
  return [...new Map(plugins.map((plugin) => [plugin.providerId, plugin])).values()];
}

async function defaultInteractionPresenter(request: InteractionPresentationRequest): Promise<void> {
  console.error(`\nInteractive task: ${request.title}`);
  if (request.instructions) console.error(request.instructions);
  console.error(`Open ${request.url}`);
}
