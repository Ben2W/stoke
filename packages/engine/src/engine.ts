import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isRigkitConfig, isProviderDefinition, isWorkflowNode } from "./authoring.ts";
import { loadDotEnv } from "./env-file.ts";
import { hash, stableJson } from "./hash.ts";
import type {
  BaseProviderPlugin,
  InteractionPresenter,
  InteractionPresentationRequest,
  ProviderFactory,
  ProviderRuntimeContext,
  SshConnection,
  WorkflowProviderController,
  WorkflowWorkspaceProvider,
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
  ProviderWorkspaceContext,
  WorkflowInputFieldDefinition,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowNodeDefinition,
  WorkflowOperationDefinition,
  WorkflowHostCapabilityRequirement,
  WorkflowHostMethodRequirement,
  WorkflowPlan,
  WorkflowPlanNode,
  WorkflowProviderMap,
  WorkflowTaskNode,
  WorkspaceRecord,
  WorkspaceRuntimeRecord,
} from "./types.ts";

export type CreateDevMachineEngineOptions = {
  projectDir?: string;
  configPath?: string;
  statePath?: string;
  state?: StateService;
  providers?: BaseProviderPlugin[];
  providerFactory?: ProviderFactory;
  stateFactory?: StateServiceFactory;
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
  requiredHostMethods?: readonly WorkflowHostMethodRequirement[];
  requiredHostCapabilities?: readonly WorkflowHostCapabilityRequirement[];
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
  known: boolean;
  blockedReason?: string;
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

let configImportCounter = 0;

export class DevMachineEngine {
  private readonly projectDir: string;
  private readonly configPath: string;
  private readonly statePath: string;
  private state: StateService | undefined;
  private providers: BaseProviderPlugin[];
  private readonly providerFactory: ProviderFactory;
  private readonly stateFactory: StateServiceFactory;
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
          createsWorkspace: operation.createsWorkspace,
          requiredHostMethods: operation.requiredHostMethods,
          requiredHostCapabilities: operation.requiredHostCapabilities,
          inputFields: operation.input?.fields ?? [],
        };
      }),
    );
  }

  private listCoreOperationEntries(): RuntimeOperationEntry[] {
    const workflows = this.listWorkflows();
    const hasWorkspaceCreator = workflows.some((workflow) => workflow.create || workflow.workspace);
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
              description: "Create a workspace from the resolved workflow artifact",
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
              return await this.fork({
                workflow: optionalStringInput("create", parsed, "workflow"),
                name: requiredStringInput("create", parsed, "name"),
              });
            },
          ),
        ]
        : []),
      coreOperation(
        {
          workflow: "",
          id: "ssh",
          source: "core",
          kind: "command",
          title: "SSH",
          description: "Get an SSH command for a workspace or VM",
          requiredHostMethods: [{ id: "host.command.run", modes: ["interactive"] }],
          inputFields: [
            workflowField,
            stringField({ name: "workspaceOrVmId", position: 0, required: true }),
            stringField({ name: "user", required: false }),
            booleanField({ name: "print", required: false, defaultValue: false }),
          ],
          cli: {
            positionals: [
              { name: "workspaceOrVmId", index: 0 },
            ],
            options: [
              { name: "workflow", flag: "--workflow" },
              { name: "user", flag: "--user" },
              { name: "print", flag: "--print", type: "boolean" },
            ],
          },
        },
        async (input) => {
          const parsed = parseCoreOperationInput("ssh", input.input);
          const workspaceOrVmId = requiredStringInput("ssh", parsed, "workspaceOrVmId");
          const terminal = await this.attachTerminal({
            workflow: optionalStringInput("ssh", parsed, "workflow"),
            workspaceOrVmId,
            printOnly: true,
            user: optionalStringInput("ssh", parsed, "user"),
          });
          if (optionalBooleanInput("ssh", parsed, "print", false)) return terminal;
          const commandResult = await (this.local.command ?? runLocalCommand)({
            argv: ["sh", "-lc", terminal.command],
            cwd: this.projectDir,
            mode: "interactive",
            reason: `Open an SSH session to ${workspaceOrVmId}`,
            presentation: {
              visible: true,
              label: "SSH into workspace",
            },
          });
          return { ...terminal, commandResult };
        },
      ),
      coreOperation(
        {
          workflow: "",
          id: "snapshot",
          source: "core",
          kind: "command",
          title: "Snapshot",
          description: "Capture a snapshot from a workspace VM",
          inputFields: [
            workflowField,
            stringField({ name: "workspace", position: 0, required: true }),
            stringField({ name: "label", required: false }),
          ],
          cli: {
            positionals: [
              { name: "workspace", index: 0 },
            ],
            options: [
              { name: "workflow", flag: "--workflow" },
              { name: "label", flag: "--label" },
            ],
          },
        },
        async (input) => {
          const parsed = parseCoreOperationInput("snapshot", input.input);
          return await this.snapshotWorkspace({
            workflow: optionalStringInput("snapshot", parsed, "workflow"),
            workspace: requiredStringInput("snapshot", parsed, "workspace"),
            label: optionalStringInput("snapshot", parsed, "label"),
          });
        },
      ),
      coreOperation(
        {
          workflow: "",
          id: "delete",
          aliases: ["rm"],
          source: "core",
          kind: "command",
          title: "Delete",
          description: "Delete a workspace VM and remove it from state",
          inputFields: [
            workflowField,
            stringField({ name: "workspace", position: 0, required: true }),
          ],
          cli: {
            positionals: [{ name: "workspace", index: 0 }],
            options: [
              { name: "workflow", flag: "--workflow" },
              { name: "yes", flag: "--yes", aliases: ["-y"], required: true, type: "boolean", runtime: false },
            ],
          },
        },
        async (input) => {
          const parsed = parseCoreOperationInput("delete", input.input);
          return await this.deleteWorkspace({
            workflow: optionalStringInput("delete", parsed, "workflow"),
            workspace: requiredStringInput("delete", parsed, "workspace"),
          });
        },
      ),
    ];
  }

  listNodeRuns(): WorkflowNodeRunRecord[] {
    return this.getStateService().listNodeRuns();
  }

  hasOperation(operationId: string): boolean {
    return this.listWorkflows().some((workflow) => workflow.operations.some((operation) => operation.id === operationId));
  }

  async runRuntimeOperation(input: { operation: string; workflow?: string; input?: unknown }): Promise<unknown> {
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
    });
    if (result !== undefined) assertJsonValue(result, `Operation ${operation.id} result`);
    if (operation.createsWorkspace) return this.saveOperationWorkspace(workflow, operation, input.input, result);
    return result ?? null;
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
    const result = await this.evaluate({
      workflow,
      providers,
      mode: "apply",
    });
    const workspaceSource = this.resolveWorkspaceSource(workflow, result.context, providers, { required: false });

    return {
      context: result.context,
      snapshotId: snapshotIdOf(workspaceSource),
      workspaceSource,
      plan: result.plan,
    };
  }

  async fork(input: { workflow?: string; machine?: string; name: string }): Promise<WorkspaceRecord> {
    if (!input.name) throw new Error(`fork requires a workspace name`);

    const applied = await this.apply({ workflow: input.workflow ?? input.machine });
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const providers = await this.createProviders(workflow);
    if (workflow.create) {
      return await this.createWorkspaceFromCallback({
        workflow,
        providers,
        context: applied.context,
        name: input.name,
      });
    }

    const sourceRef = this.resolveWorkspaceSource(workflow, applied.context, providers, { required: true })!;
    const workspaceProvider = this.findWorkspaceProvider(providers, sourceRef);
    const created = await workspaceProvider.createWorkspace(sourceRef, { name: input.name });
    const providerId = created.providerId ?? providerIdOf(sourceRef) ?? this.providerIdForWorkspaceProvider(providers, workspaceProvider);
    const now = new Date().toISOString();

    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      providerId,
      workflow: workflow.name,
      resourceId: created.resourceId,
      snapshotId: created.snapshotId,
      sourceRef: created.sourceRef ?? sourceRef,
      context: { ...applied.context },
      createdAt: now,
      updatedAt: now,
      metadata: created.metadata ?? {},
    };

    this.getStateService().saveWorkspace(workspace);
    await this.runWorkspaceCreatedHook({
      workflow,
      providers,
      workspaceProvider,
      workspace,
      context: applied.context,
    });

    this.emit({
      type: "workspace.ready",
      workspaceId: input.name,
      providerId: workspace.providerId,
      resourceId: workspace.resourceId,
      snapshotId: workspace.snapshotId,
    });

    return workspace;
  }

  async attachTerminal(input: {
    workspaceOrVmId: string;
    workflow?: string;
    machine?: string;
    printOnly?: boolean;
    user?: string;
  }): Promise<{ command: string }> {
    const workspace = this.getStateService().findWorkspace(input.workspaceOrVmId);
    const workflow = this.getWorkflow(input.workflow ?? input.machine ?? workspace?.workflow);
    const providers = await this.createProviders(workflow);
    const workspaceProvider = workspace
      ? this.workspaceProviderById(providers, workspace.providerId)
      : this.singleWorkspaceProvider(providers);
    if (workspace) {
      await this.runWorkspaceOpenHook({
        workflow,
        providers,
        workspaceProvider,
        workspace,
        context: workspace.context,
      });
    }
    const terminal = await workspaceProvider.ssh(workspace?.resourceId ?? input.workspaceOrVmId, { user: input.user });

    if (!input.printOnly) {
      const proc = Bun.spawn(["sh", "-lc", terminal.command], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    }

    return { command: terminal.command };
  }

  async deleteWorkspace(input: { workspace: string; workflow?: string; machine?: string }): Promise<WorkspaceRecord> {
    const workspace = this.getStateService().getWorkspace(input.workspace);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);

    const workflow = this.getWorkflow(input.workflow ?? input.machine ?? workspace.workflow);
    const providers = await this.createProviders(workflow);
    const workspaceProvider = this.workspaceProviderById(providers, workspace.providerId);
    await workspaceProvider.deleteWorkspace(workspace);

    this.getStateService().deleteWorkspace(input.workspace);

    return workspace;
  }

  async snapshotWorkspace(input: { workspace: string; label?: string; workflow?: string; machine?: string }): Promise<WorkflowNodeRunRecord> {
    const workspace = this.getStateService().getWorkspace(input.workspace);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);

    const workflow = this.getWorkflow(input.workflow ?? input.machine ?? workspace.workflow);
    const providers = await this.createProviders(workflow);
    const workspaceProvider = this.workspaceProviderById(providers, workspace.providerId);
    const snapshot = await workspaceProvider.snapshotWorkspace(workspace);
    const sourceRef = snapshot.sourceRef ?? workspace.sourceRef;
    const providerFingerprint = providerFingerprintFor(workflow);
    const now = new Date().toISOString();
    const record: WorkflowNodeRunRecord = {
      id: crypto.randomUUID(),
      workflow: workflow.name,
      nodePath: `workspace.${workspace.name}`,
      nodeName: input.label ?? `workspace:${workspace.name}`,
      nodeKind: "workspace-snapshot",
      nodeKey: hash({
        kind: "workspace-snapshot",
        workspace: workspace.name,
        label: input.label ?? null,
      }),
      providerFingerprint,
      upstreamRunIds: [],
      output: { sourceRef },
      artifacts: collectArtifacts(sourceRef),
      invalidated: false,
      createdAt: now,
      metadata: {
        workspace: workspace.name,
        label: input.label ?? null,
        snapshotId: snapshot.snapshotId ?? null,
      },
    };

    this.getStateService().saveNodeRun(record);
    return record;
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
      } else {
        known = false;
        blockedReason ??= branchState.blockedReason ?? `depends on ${branchName}`;
      }
    }

    return {
      context: known ? { ...input.state.context, ...branchOutputs } : { ...input.state.context },
      upstreamRunIds: known ? joinedRunIds.sort() : [],
      known,
      blockedReason,
      planNodes: input.planNodes,
    };
  }

  private async evaluateTask(input: EvaluateNodeInput & { node: WorkflowTaskNode<any, any, any> }): Promise<EvaluationResult> {
    const nodePath = [...input.prefix, input.node.name].join(".");
    const upstreamRunIds = [...input.state.upstreamRunIds];
    const nodeKey = hash({
      cache: "task-v2",
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
    });

    if (cached) {
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
        context: { ...input.state.context, ...cached.output },
        upstreamRunIds: [cached.id],
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
    const result = await input.node.handler({
      ...runtime,
      providers: runtime,
      ctx: Object.freeze({ ...input.state.context }),
      runtime: {
        workflow: input.workflow.name,
        nodePath,
        metadata: (value) => {
          Object.assign(metadata, value);
        },
        log: (data, options = {}) => {
          this.emit({
            type: "log.output",
            nodePath,
            stream: options.stream ?? "info",
            label: options.label,
            data,
          });
        },
      },
    });
    const output = normalizeTaskOutput(nodePath, result, input.node.options?.output, "fresh");
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

    return {
      context: { ...input.state.context, ...output },
      upstreamRunIds: [record.id],
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
  }): Promise<WorkflowNodeRunRecord | undefined> {
    const cached = this.getStateService().findReusableNodeRun(input);
    if (!cached) return undefined;

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

  private async runWorkspaceCreatedHook(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    workspaceProvider: WorkflowWorkspaceProvider;
    workspace: WorkspaceRecord;
    context: Record<string, JsonValue>;
  }): Promise<void> {
    await this.runWorkspaceHook("created", input.workflow.workspace?.onCreated, input);
  }

  private async runWorkspaceOpenHook(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    workspaceProvider: WorkflowWorkspaceProvider;
    workspace: WorkspaceRecord;
    context: Record<string, JsonValue>;
  }): Promise<void> {
    await this.runWorkspaceHook("open", input.workflow.workspace?.onOpen, input);
  }

  private async runWorkspaceHook(
    lifecycle: "created" | "open",
    hook: ((context: {
      workspace: WorkspaceRuntimeRecord;
      ctx: Readonly<Record<string, JsonValue>>;
      providers: ProviderRuntimeMap<WorkflowProviderMap>;
      providerContext: ProviderWorkspaceContext;
      local: LocalWorkspaceRuntime;
    }) => Promise<void> | void) | undefined,
    input: {
      workflow: LoadedWorkflow;
      providers: ProviderControllers;
      workspaceProvider: WorkflowWorkspaceProvider;
      workspace: WorkspaceRecord;
      context: Record<string, JsonValue>;
    },
  ): Promise<void> {
    if (!hook) return;

    const providerContext = await input.workspaceProvider.workspaceContext?.(input.workspace) ?? {};
    const workspace: WorkspaceRuntimeRecord = {
      ...input.workspace,
      cwd: resolveWorkspaceCwd(input.workflow, input.context),
    };
    const metadata: JsonObject = {};
    const providers = await this.createTaskRuntime({
      workflow: input.workflow,
      providers: input.providers,
      nodePath: `workspace.${input.workspace.name}.${lifecycle}`,
      metadata,
    });

    await hook({
      workspace,
      ctx: Object.freeze({ ...input.context }),
      providers,
      providerContext: normalizeProviderWorkspaceContext(providerContext),
      local: this.local,
    });
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
    operation: WorkflowOperationDefinition<any, any>,
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
        resolved[field.name] = {
          ...workspace,
          cwd: resolveWorkspaceCwd(workflow, workspace.context),
          data: workspace.metadata,
        };
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

  private saveOperationWorkspace(
    workflow: LoadedWorkflow,
    operation: WorkflowOperationDefinition<any, any>,
    rawInput: unknown,
    result: unknown,
  ): WorkspaceRecord {
    if (!isPlainObject(result)) {
      throw new Error(`Operation ${operation.id} must return an object when createsWorkspace is true`);
    }
    const data = result as Record<string, JsonValue>;
    const raw = isPlainObject(rawInput) ? rawInput : {};
    const name = typeof data.name === "string"
      ? data.name
      : typeof raw.name === "string"
        ? raw.name
        : undefined;
    if (!name) throw new Error(`Operation ${operation.id} must return or receive a workspace name`);
    const resourceId = typeof data.resourceId === "string"
      ? data.resourceId
      : typeof data.vmId === "string"
        ? data.vmId
        : name;
    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      providerId: typeof data.providerId === "string" ? data.providerId : "config",
      workflow: workflow.name,
      resourceId,
      snapshotId: typeof data.snapshotId === "string" ? data.snapshotId : undefined,
      sourceRef: isJsonValue(data.sourceRef) ? data.sourceRef : data,
      context: {},
      createdAt: now,
      updatedAt: now,
      metadata: data,
    };
    this.getStateService().saveWorkspace(workspace);
    this.emit({
      type: "workspace.ready",
      workspaceId: workspace.name,
      providerId: workspace.providerId,
      resourceId: workspace.resourceId,
      snapshotId: workspace.snapshotId,
    });
    return workspace;
  }

  private async createWorkspaceFromCallback(input: {
    workflow: LoadedWorkflow;
    providers: ProviderControllers;
    context: Record<string, JsonValue>;
    name: string;
  }): Promise<WorkspaceRecord> {
    if (!input.workflow.create) {
      throw new Error(`Workflow ${input.workflow.name} does not define a create callback`);
    }
    const metadata: JsonObject = {};
    const runtime = await this.createTaskRuntime({
      workflow: input.workflow,
      providers: input.providers,
      nodePath: `create.${input.name}`,
      metadata,
    });
    const result = await input.workflow.create.handler({
      ...runtime,
      ctx: Object.freeze({ ...input.context }),
      name: input.name,
      providers: runtime,
      local: this.local,
      workflow: input.workflow.name,
    });
    assertJsonValue(result, `Workflow ${input.workflow.name} create result`);
    if (!isPlainObject(result)) {
      throw new Error(`Workflow ${input.workflow.name} create result must be an object`);
    }

    const data = result as Record<string, JsonValue>;
    const name = typeof data.name === "string" ? data.name : input.name;
    const resourceId = typeof data.resourceId === "string"
      ? data.resourceId
      : typeof data.vmId === "string"
        ? data.vmId
        : name;
    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      providerId: typeof data.providerId === "string" ? data.providerId : "config",
      workflow: input.workflow.name,
      resourceId,
      snapshotId: typeof data.snapshotId === "string" ? data.snapshotId : undefined,
      sourceRef: isJsonValue(data.sourceRef) ? data.sourceRef : data,
      context: { ...input.context },
      createdAt: now,
      updatedAt: now,
      metadata: data,
    };

    this.getStateService().saveWorkspace(workspace);
    this.emit({
      type: "workspace.ready",
      workspaceId: workspace.name,
      providerId: workspace.providerId,
      resourceId: workspace.resourceId,
      snapshotId: workspace.snapshotId,
    });
    return workspace;
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
      create: root.createDefinition,
      operations: root.operations ?? [],
    };
  }

  private resolveWorkspaceSource(
    workflow: LoadedWorkflow,
    context: Record<string, JsonValue>,
    providers: ProviderControllers,
    options: { required: boolean },
  ): JsonValue | undefined {
    const source = workflow.workspace?.source?.(context);
    if (source !== undefined) {
      assertJsonValue(source, `Workflow ${workflow.name} workspace source`);
      return source;
    }

    const candidates = collectArtifacts(context).filter((artifact) =>
      Object.values(providers).some((provider) => provider.workspace?.canUse(artifact)),
    );

    if (candidates.length === 1) return candidates[0];
    if (!options.required && candidates.length === 0) return undefined;
    if (candidates.length === 0) {
      throw new Error(`Workflow ${workflow.name} did not produce a provider artifact that can be forked`);
    }
    throw new Error(`Workflow ${workflow.name} produced multiple forkable artifacts; configure workspace.source`);
  }

  private findWorkspaceProvider(
    providers: ProviderControllers,
    sourceRef: JsonValue,
  ): WorkflowWorkspaceProvider {
    const provider = Object.values(providers).find((controller) => controller.workspace?.canUse(sourceRef));
    if (!provider?.workspace) {
      throw new Error(`No workflow provider can create a workspace from ${stableJson(sourceRef)}`);
    }
    return provider.workspace;
  }

  private workspaceProviderById(
    providers: ProviderControllers,
    providerId: string,
  ): WorkflowWorkspaceProvider {
    const provider = Object.values(providers).find((controller) => controller.providerId === providerId);
    if (!provider?.workspace) {
      throw new Error(`Provider ${providerId} does not support workspaces`);
    }
    return provider.workspace;
  }

  private singleWorkspaceProvider(providers: ProviderControllers): WorkflowWorkspaceProvider {
    const workspaceProviders = Object.values(providers).filter((provider) => provider.workspace);
    if (workspaceProviders.length !== 1 || !workspaceProviders[0]?.workspace) {
      throw new Error(`Expected exactly one workspace-capable provider`);
    }
    return workspaceProviders[0].workspace;
  }

  private providerIdForWorkspaceProvider(
    providers: ProviderControllers,
    workspaceProvider: WorkflowWorkspaceProvider,
  ): string {
    for (const provider of Object.values(providers)) {
      if (provider.workspace === workspaceProvider) return provider.providerId;
    }
    return "unknown";
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
    createsWorkspace: Boolean(workflow.create || workflow.workspace),
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

function normalizeTaskOutput(
  nodePath: string,
  result: unknown,
  schema: OutputSchema | undefined,
  source: "fresh" | "cached",
): Record<string, JsonValue> | undefined {
  const value = schema ? parseWithSchema(schema, result, source) : result;
  if (value === undefined) return source === "cached" && schema ? undefined : {};
  if (!isPlainObject(value)) {
    if (source === "cached") return undefined;
    throw new Error(`Task ${nodePath} must return an object with JSON-serializable context values`);
  }

  for (const [key, item] of Object.entries(value)) {
    assertJsonValue(item, `Task ${nodePath} return value ${key}`);
  }

  return value as Record<string, JsonValue>;
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

function snapshotIdOf(value: unknown): string | undefined {
  return isPlainObject(value) && typeof value.snapshotId === "string" ? value.snapshotId : undefined;
}

function resolveWorkspaceCwd(workflow: LoadedWorkflow, context: Record<string, JsonValue>): string | undefined {
  const cwd = workflow.workspace?.cwd;
  return typeof cwd === "function" ? cwd(context) : cwd;
}

function normalizeProviderWorkspaceContext(value: unknown): ProviderWorkspaceContext {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new Error(`Provider workspace context must be an object`);
  }
  return value as ProviderWorkspaceContext;
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

const RESERVED_HOST_OPERATION_IDS = new Set([
  "completion",
  "doctor",
  "help",
  "init",
  "projects",
  "run",
  "version",
]);

const CORE_OPERATION_INPUT_FIELDS: Record<string, readonly string[]> = {
  plan: ["workflow"],
  apply: ["workflow", "dryRun"],
  create: ["workflow", "name"],
  ssh: ["workflow", "workspaceOrVmId", "user", "print"],
  snapshot: ["workflow", "workspace", "label"],
  delete: ["workflow", "workspace"],
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
