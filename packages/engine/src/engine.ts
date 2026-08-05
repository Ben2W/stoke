import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isProviderDefinition, isWorkflowNode } from "./authoring.ts";
import { runWithStepConsole, type ConsoleLevel, type StepConsoleSink } from "./console-intercept.ts";
import { loadDotEnv } from "./env-file.ts";
import { hash, stableJson } from "./hash.ts";
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
  type WorkflowApplyRecord,
  type WorkflowNodeRunRecord,
} from "./state.ts";
import type {
  EventHandler,
  HostCapabilityRequirement,
  JsonObject,
  JsonValue,
  LoadedProviderDefinition,
  LoadedWorkflow,
  LocalWorkspaceRuntime,
  OutputSchema,
  ProviderRuntimeMap,
  WorkflowInputFieldDefinition,
  WorkflowDefinition,
  WorkflowCacheScope,
  WorkflowEvent,
  WorkflowLogStream,
  WorkflowNodeKind,
  WorkflowNodeDefinition,
  WorkflowOperationDefinition,
  WorkflowOperationInputSchema,
  WorkflowPlan,
  WorkflowPlanNode,
  WorkflowProviderMap,
  WorkflowProviderDefinition,
  WorkflowProviderCheck,
  WorkflowProviderCheckResult,
  WorkflowStepInvalidation,
  WorkflowTaskCacheTTL,
  WorkflowTaskNode,
  WorkspaceRecord,
  WorkspaceRuntimeRecord,
  WorkflowWorkspaceOperationDefinition,
  WorkspaceOperationRecord,
} from "./types.ts";

export type CreateDevMachineEngineOptions = {
  projectDir?: string;
  configPath?: string;
  state?: StateService;
  providers?: BaseProviderPlugin[];
  providerFactory?: ProviderFactory;
  stateFactory?: StateServiceFactory;
  hostStorageDir?: string;
  hostStorageFactory?: ProviderHostStorageFactory;
  interaction?: {
    present?: InteractionPresenter;
  };
  local?: LocalWorkspaceRuntimeOptions;
  workspaceCreatedFrom?: WorkspaceRecord["createdFrom"];
  workspaceSourceRevision?: string;
};

export type { InteractionPresenter, InteractionPresentationRequest };

export type GlobalFragmentStateLocationInput = {
  hash: string;
  workflow: string;
  nodePath: string;
  nodeName: string;
  nodeKind: WorkflowNodeKind;
};

export type EngineLoadResult = {
  workflows: LoadedWorkflow[];
  projectDir: string;
  configPath: string;
};

export type EngineProjectInfo = {
  projectDir: string;
  configPath: string;
  workflows: WorkflowSummary[];
};

export type LocalWorkspaceRuntimeOptions =
  & Partial<Omit<LocalWorkspaceRuntime, "prompt">>
  & {
    prompt?: Partial<NonNullable<LocalWorkspaceRuntime["prompt"]>>;
  };

export type EngineCacheScope = WorkflowCacheScope;

export type EngineCacheEntry = {
  scope: EngineCacheScope;
  workflow: string;
  nodePath: string;
  displayPath?: string;
  planIndex?: number;
  nodeName: string;
  nodeKind: string;
  runId: string;
  invalidated: boolean;
  createdAt: string;
  fragmentHash?: string;
};

export type EngineCacheList = {
  entries: EngineCacheEntry[];
};

export type EngineCacheClearScope = EngineCacheScope | "all";

export type EngineCacheClearResult = {
  deleted: number;
};

export type EngineCacheExplainReasonCode =
  | "cached"
  | "upstream-pending"
  | "no-previous-run"
  | "invalidated"
  | "task-changed"
  | "provider-changed"
  | "upstream-changed"
  | "expired"
  | "output-schema-invalid"
  | "artifact-invalid"
  | "unknown";

export type EngineCacheExplainReason = {
  code: EngineCacheExplainReasonCode;
  message: string;
  detail?: string;
};

export type EngineCacheExplainCandidate = {
  runId: string;
  scope: EngineCacheScope;
  nodePath: string;
  displayPath: string;
  nodeName: string;
  nodeKind: string;
  createdAt: string;
  invalidated: boolean;
  fragmentHash?: string;
  reasons: EngineCacheExplainReason[];
};

export type EngineCacheExplanation = {
  workflow: string;
  path: string;
  name: string;
  status: "cached" | "pending";
  reason: EngineCacheExplainReason;
  runId?: string;
  scope: EngineCacheScope;
  cacheWorkflow: string;
  cacheNodePath: string;
  upstreamRunIds: string[];
  cacheTTL?: WorkflowTaskCacheTTL;
  candidates: EngineCacheExplainCandidate[];
};

export type EngineCacheExplainResult = {
  workflow: string;
  explanations: EngineCacheExplanation[];
};

export type WorkflowSummary = {
  name: string;
  providers: string[];
  nodes: string[];
  operations: string[];
  createsWorkspace: boolean;
  lastAppliedAt?: string;
  lastAppliedCachedNodeCount?: number;
  lastAppliedNodeCount?: number;
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
  inputSchema?: Record<string, unknown>;
  requiredCapabilities?: readonly HostCapabilityRequirement[];
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
type LoadedProviderScope = Record<string, LoadedProviderDefinition>;
type ProviderControllerCache = Map<string, WorkflowProviderController>;

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
  cache: EvaluationCacheTarget;
};

type EvaluationCacheTarget = {
  scope: WorkflowCacheScope;
  workflow: string;
  nodePath: string;
  state: StateService;
  fragmentHash?: string;
};

type CacheInvalidateTarget = {
  scope: WorkflowCacheScope;
  nodePath: string;
  fragmentHash?: string;
};

type EvaluationResult = EvaluationState & {
  planNodes: WorkflowPlanNode[];
};

type EvaluateNodeInput = {
  workflow: LoadedWorkflow;
  node: WorkflowNodeDefinition<any, any, any>;
  mode: EvaluationMode;
  cache: EvaluationCacheTarget;
  configStack: JsonObject[];
  state: EvaluationState;
  providerControllerCache: ProviderControllerCache;
  providerChecks: Map<string, WorkflowProviderCheck>;
  prefix: string[];
  cachePrefix: string[];
  root: boolean;
  suppressSequenceName?: string;
  suppressCacheSequenceName?: string;
  planNodes: WorkflowPlanNode[];
  cacheExplanations: EngineCacheExplanation[];
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

type DefinitionSourceFile = {
  path: string;
  source: string;
};

function projectDirForConfigPath(configPath: string): string {
  const configDir = dirname(configPath);
  return basename(configDir) === "stoke" ? dirname(configDir) : configDir;
}

function canonicalConfigPath(projectDir: string): string {
  return join(projectDir, "stoke", "index.ts");
}

function definitionSourcesFor(configPath: string): DefinitionSourceFile[] {
  const configDir = dirname(configPath);
  return collectDefinitionFiles(configDir).map((file) => ({
    path: file.slice(configDir.length + 1),
    source: readFileSync(file, "utf8"),
  }));
}

function collectDefinitionFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDefinitionFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else if (entry.isSymbolicLink()) {
      const stat = statSync(path);
      if (stat.isFile()) files.push(path);
    }
  }
  return files.sort();
}

// The engine owns the workflow graph, cache, and event emission for one
// project. The runtime daemon hosts a single long-lived instance per project.
export class DevMachineEngine {
  private readonly projectDir: string;
  private readonly configPath: string;
  private state: StateService | undefined;
  private providers: BaseProviderPlugin[];
  private readonly providerFactory: ProviderFactory;
  private readonly stateFactory: StateServiceFactory;
  private readonly globalFragmentStates = new Map<string, { input: GlobalFragmentStateLocationInput; state: StateService }>();
  private evaluationFragmentHashes: Set<string> | undefined;
  private readonly hostStorageDir: string;
  private readonly hostStorageFactory: ProviderHostStorageFactory;
  private readonly providerHostStorage = new Map<string, ReturnType<ProviderHostStorageFactory>>();
  private readonly interactionPresenter: InteractionPresenter;
  private readonly local: LocalWorkspaceRuntime;
  private readonly workspaceCreatedFrom?: WorkspaceRecord["createdFrom"];
  private readonly workspaceSourceRevision?: string;
  private readonly handlers = new Set<EventHandler>();
  private workflows = new Map<string, LoadedWorkflow>();
  private definitionSources: DefinitionSourceFile[] = [];

  constructor(options: CreateDevMachineEngineOptions = {}) {
    const requestedConfigPath = options.configPath ? resolve(options.configPath) : undefined;
    this.projectDir = resolve(options.projectDir ?? (requestedConfigPath ? projectDirForConfigPath(requestedConfigPath) : process.cwd()));
    this.configPath = requestedConfigPath ?? canonicalConfigPath(this.projectDir);
    const expectedConfigPath = canonicalConfigPath(this.projectDir);
    if (this.configPath !== expectedConfigPath) {
      throw new Error(`Stoke config must be ${expectedConfigPath}; ${this.configPath} is not supported.`);
    }
    this.state = options.state;
    this.providers = options.providers ?? [];
    this.providerFactory = options.providerFactory ?? ((input) => this.createProviderFromPlugin(input));
    this.stateFactory = options.stateFactory ?? createStateStore;
    this.hostStorageDir = options.hostStorageDir ? resolve(options.hostStorageDir) : defaultProviderHostStorageDir();
    this.hostStorageFactory = options.hostStorageFactory ?? createFileProviderHostStorage;
    this.interactionPresenter = options.interaction?.present ?? defaultInteractionPresenter;
    this.workspaceCreatedFrom = options.workspaceCreatedFrom ? { ...options.workspaceCreatedFrom } : undefined;
    this.workspaceSourceRevision = options.workspaceSourceRevision;
    this.local = {
      open: options.local?.open ?? openLocalTarget,
      prompt: {
        message: options.local?.prompt?.message ?? showLocalMessage,
        text: options.local?.prompt?.text ?? promptLocalText,
        confirm: options.local?.prompt?.confirm ?? confirmLocalPrompt,
        select: options.local?.prompt?.select ?? selectLocalOption,
      },
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
        `No Stoke config found at ${this.configPath}. Run "stoke init".`,
      );
    }

    this.definitionSources = definitionSourcesFor(this.configPath);

    const moduleUrl = pathToFileURL(this.configPath);
    moduleUrl.searchParams.set("t", `${Date.now()}-${configImportCounter++}`);
    const mod = await import(moduleUrl.href);
    const roots = normalizeDefinitions(mod);
    const loaded = await Promise.all(roots.map((root) => this.resolveWorkflow(root)));
    if (loaded.length === 0) {
      throw new Error(`stoke/index.ts must export at least one workflow`);
    }
    this.providers = mergeProviderPlugins([
      ...this.providers,
      ...roots.flatMap((root) => collectProviderDefinitions(root))
        .map((provider) => provider.plugin)
        .filter(isBaseProviderPlugin),
    ]);
    this.state ??= this.stateFactory({
      projectDir: this.projectDir,
      configPath: this.configPath,
      scope: "project",
    });

    this.workflows = new Map(loaded.map((item) => [item.name, item]));
    if (this.workflows.size !== loaded.length) {
      throw new Error(`Workflow names must be unique`);
    }
    for (const item of loaded) {
      this.emit({ type: "definition.loaded", workflow: item.name });
    }

    return {
      workflows: loaded,
      projectDir: this.projectDir,
      configPath: this.configPath,
    };
  }

  listWorkflows(): LoadedWorkflow[] {
    return [...this.workflows.values()];
  }

  listMachines(): LoadedWorkflow[] {
    return this.listWorkflows();
  }

  getProjectInfo(): EngineProjectInfo {
    return {
      projectDir: this.projectDir,
      configPath: this.configPath,
      workflows: this.listWorkflowSummaries(),
    };
  }

  listWorkflowSummaries(): WorkflowSummary[] {
    return this.listWorkflows().map((workflow) =>
      summarizeWorkflow(workflow, this.getStateService().getWorkflowApply(workflow.name))
    );
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.getStateService().listWorkspaces();
  }

  private workspaceOperationsFor(workflow: LoadedWorkflow): WorkspaceOperationRecord[] {
    return workflow.workspaceOperations.map((operation) => {
      const summary = this.workspaceOperationSummary(workflow, operation);
      return {
        id: summary.id,
        ...(summary.title ? { title: summary.title } : {}),
        ...(summary.description ? { description: summary.description } : {}),
        ...(summary.inputSchema
          ? { inputSchema: summary.inputSchema as Record<string, JsonValue> }
          : {}),
        requiredCapabilities: [...(summary.requiredCapabilities ?? [])],
      };
    });
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
          requiredCapabilities: requiredCapabilitiesForScope(operation.providerScope),
          inputFields: [],
          inputSchema: operation.input ? operationInputJsonSchema(operation) : undefined,
        };
      }),
    );
  }

  private listConfigWorkspaceOperationEntries(): RuntimeWorkspaceOperationEntry[] {
    return this.listWorkflows().flatMap((workflow) =>
      workflow.workspaceOperations.map((operation) => ({
        summary: this.workspaceOperationSummary(workflow, operation),
        run: async (input) => {
          const workspace = this.resolveWorkspace(input.workspace, workflow.name, operation.id);
          if (workspace.workflow !== workflow.name) {
            throw new EngineOperationValidationError({
              operation: operation.id,
              message: `Workspace ${workspace.name} belongs to workflow ${workspace.workflow}, not ${workflow.name}`,
            });
          }
          const providers = await this.createProviders(operation.providerScope);
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
      requiredCapabilities: requiredCapabilitiesForScope(operation.providerScope),
      inputFields: [],
      inputSchema: operation.input ? operationInputJsonSchema(operation) : undefined,
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
                positionals: [
                  { name: "name", index: 0 },
                ],
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

  async listCache(input: {
    workflow?: string;
    machine?: string;
    includeUnreachable?: boolean;
  } = {}): Promise<EngineCacheList> {
    if (!input.workflow && !input.machine) {
      const entries = (await Promise.all(
        this.listWorkflows().map((workflow) =>
          this.listCache({ workflow: workflow.name, includeUnreachable: input.includeUnreachable })
        ),
      )).flatMap((cache) => cache.entries);
      return { entries };
    }

    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const evaluated = await this.evaluate({
      workflow,
      mode: "plan",
    });

    // The plan tells us which row (by runId) would satisfy each cached node
    // under the *current* code. Those are the only cache rows that matter.
    const reachableRunIds = new Set<string>();
    for (const node of evaluated.plan.nodes) {
      if (node.status === "cached" && node.runId) reachableRunIds.add(node.runId);
    }
    const reachableNodesByRunId = new Map(
      evaluated.plan.nodes
        .filter((node): node is WorkflowPlanNode & { runId: string } => node.status === "cached" && !!node.runId)
        .map((node) => [node.runId, node]),
    );

    if (input.includeUnreachable) {
      const entries: EngineCacheEntry[] = [
        ...this.getStateService()
          .listNodeRuns()
          .filter((run) => run.workflow === workflow.name)
          .map((run) => cacheEntryForRun(run, "local", undefined, undefined, reachableNodesByRunId.get(run.id))),
      ];
      for (const fragmentHash of evaluated.fragments) {
        const fragment = this.globalFragmentStates.get(fragmentHash);
        if (!fragment) continue;
        entries.push(
          ...fragment.state
            .listNodeRuns()
            .map((run) =>
              cacheEntryForRun(run, "global", fragmentHash, workflow.name, reachableNodesByRunId.get(run.id))
            ),
        );
      }
      entries.sort(compareCacheEntries);
      return { entries };
    }

    // Local state is per-project — anything not reachable is dead weight, so
    // prune as a side effect. Global fragments are shared across projects;
    // another project might still reach the row we'd consider unreachable
    // here, so we only filter the display for globals — never delete.
    const localRuns = this.getStateService().listNodeRuns()
      .filter((run) => run.workflow === workflow.name);
    const localStaleIds = localRuns
      .filter((run) => !reachableRunIds.has(run.id))
      .map((run) => run.id);
    if (localStaleIds.length > 0) {
      this.getStateService().deleteNodeRunsById(localStaleIds);
    }

    const entries: EngineCacheEntry[] = localRuns
      .filter((run) => reachableRunIds.has(run.id))
      .map((run) => cacheEntryForRun(run, "local", undefined, undefined, reachableNodesByRunId.get(run.id)));

    for (const fragmentHash of evaluated.fragments) {
      const fragment = this.globalFragmentStates.get(fragmentHash);
      if (!fragment) continue;
      entries.push(
        ...fragment.state
          .listNodeRuns()
          .filter((run) => reachableRunIds.has(run.id))
          .map((run) =>
            cacheEntryForRun(run, "global", fragmentHash, workflow.name, reachableNodesByRunId.get(run.id))
          ),
      );
    }

    entries.sort(compareCacheEntries);
    return { entries };
  }

  async explainCache(input: {
    workflow: string;
    task?: string;
  }): Promise<EngineCacheExplainResult> {
    const workflow = this.getWorkflow(input.workflow);
    const evaluated = await this.evaluate({
      workflow,
      mode: "plan",
    });
    const explanations = input.task
      ? resolveCacheExplainTargets(input.task, evaluated.cacheExplanations)
      : evaluated.cacheExplanations;
    return {
      workflow: workflow.name,
      explanations,
    };
  }

  async invalidateCache(input: {
    workflow: string;
    machine?: string;
    nodePaths?: readonly string[];
  }): Promise<{ invalidated: number }> {
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const cache = await this.listCache({ workflow: workflow.name });
    const entries = cache.entries.filter((entry) => !entry.invalidated);
    // If no explicit paths, invalidate every cached node for this workflow.
    const targets = input.nodePaths && input.nodePaths.length > 0
      ? resolveCacheInvalidateTargets(input.nodePaths, entries)
      : entries.map(cacheInvalidateTargetForEntry);
    return { invalidated: this.invalidateCacheTargets(targets, workflow.name) };
  }

  async clearCache(input: {
    workflow: string;
    machine?: string;
    scope?: EngineCacheClearScope;
  }): Promise<EngineCacheClearResult> {
    const scope = input.scope ?? "all";
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    const evaluated = await this.evaluate({
      workflow,
      mode: "plan",
    });

    let deleted = 0;
    if (scope === "all" || scope === "local") {
      deleted += this.getStateService().clearNodeRuns({ workflow: workflow.name });
    }
    if (scope === "all" || scope === "global") {
      for (const fragmentHash of evaluated.fragments) {
        const fragment = this.globalFragmentStates.get(fragmentHash);
        if (!fragment) continue;
        deleted += fragment.state.clearNodeRuns();
      }
    }
    return { deleted };
  }

  hasOperation(operationId: string): boolean {
    return this.listWorkflows().some((workflow) => workflow.operations.some((operation) => operation.id === operationId));
  }

  async runRuntimeOperation(input: { operation: string; workflow?: string; input?: unknown }): Promise<unknown> {
    const workflowName = input.workflow ?? workflowNameFromInput(input.input);
    const workspaceTarget = parseWorkspaceOperationId(input.operation);
    if (workspaceTarget) {
      return await this.runWorkspaceOperation({
        workspace: workspaceTarget.workspace,
        operation: workspaceTarget.operation,
        workflow: workflowName,
        input: input.input,
      });
    }
    const operation = this.findRuntimeOperationEntry(input.operation, workflowName);
    if (!operation) throw new EngineOperationNotFoundError(input.operation);
    return await operation.run({ workflow: workflowName, input: input.input });
  }

  async runOperation(input: { operation: string; workflow?: string; input?: unknown }): Promise<unknown> {
    const { workflow, operation } = this.getWorkflowOperation(input.operation, input.workflow);
    const providers = await this.createProviders(operation.providerScope);
    await this.requireProviderChecks(workflow.name, providers);
    const metadata: JsonObject = {};
    const runtime = await this.createTaskRuntime({
      workflow,
      providers,
      nodePath: `operation.${operation.id}`,
      metadata,
    });
    const operationInput = this.resolveOperationInput(workflow, operation, input.input ?? {});
    const operationNodePath = `operation.${operation.id}`;
    const result = await this.withStepConsole(operationNodePath, () => operation.run({
      input: Object.freeze(operationInput),
      providers: runtime,
      local: this.local,
      workflow: workflow.name,
      step: this.createStepRuntime(workflow.name, operationNodePath, metadata),
    }));
    if (result !== undefined) assertJsonValue(result, `Operation ${operation.id} result`);
    return result ?? null;
  }

  async runWorkspaceOperation(input: {
    workspace: string;
    operation: string;
    workflow?: string;
    input?: unknown;
  }): Promise<unknown> {
    const workspace = this.resolveWorkspace(input.workspace, input.workflow, input.operation);
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
    const providers = await this.createProviders(operation.providerScope);
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
    const result = await this.evaluate({
      workflow,
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
    const startedAt = Date.now();
    this.emit({ type: "workflow.apply.started", workflow: workflow.name });
    let result: { context: Record<string, JsonValue>; plan: WorkflowPlan } | undefined;
    const maxRestarts = 8;
    for (let attempt = 0; attempt <= maxRestarts; attempt++) {
      try {
        result = await this.evaluate({
          workflow,
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
    this.getStateService().saveWorkflowApply({
      workflow: workflow.name,
      providerFingerprint: result.plan.providerFingerprint,
      cachedNodeCount: result.plan.cachedNodeCount,
      nodeCount: result.plan.nodeCount,
      appliedAt: new Date().toISOString(),
    });

    this.emit({
      type: "workflow.apply.completed",
      workflow: workflow.name,
      nodeCount: result.plan.nodeCount,
      cachedNodeCount: result.plan.cachedNodeCount,
      durationMs: Date.now() - startedAt,
    });

    return {
      context: result.context,
      plan: result.plan,
    };
  }

  async fork(input: { workflow?: string; machine?: string; name: string }): Promise<WorkspaceRecord> {
    return await this.createWorkspace(input);
  }

  async createWorkspace(input: { workflow?: string; machine?: string; name: string }): Promise<WorkspaceRecord> {
    assertValidWorkspaceName(input.name);
    const workflow = this.getWorkflow(input.workflow ?? input.machine);
    if (this.getStateService().getWorkspace(input.name, workflow.name)) {
      throw new Error(`Workspace ${input.name} already exists in workflow ${workflow.name}`);
    }

    const applied = await this.apply({ workflow: workflow.name });
    if (!workflow.workspace) {
      throw new Error(`Workflow ${workflow.name} does not define a workspace`);
    }
    const providers = await this.createProviders(workflow.workspace.providerScope);
    await this.requireProviderChecks(workflow.name, providers);

    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      workflow: workflow.name,
      ...(this.workspaceSourceRevision ? { sourceRevision: this.workspaceSourceRevision } : {}),
      cacheEntryIds: applied.plan.nodes.flatMap((node) => node.runId ? [node.runId] : []),
      workflowCtx: { ...applied.context },
      ctx: {},
      operations: this.workspaceOperationsFor(workflow),
      ...(this.workspaceCreatedFrom ? { createdFrom: { ...this.workspaceCreatedFrom } } : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.getStateService().saveWorkspace(workspace);
    this.emit({ type: "workspace.create.started", workspaceName: input.name });
    try {
      await this.runWorkspaceCreate({
        workflow,
        providers,
        workspace,
        context: applied.context,
        name: input.name,
      });
    } catch (error) {
      this.getStateService().deleteWorkspace(workspace.name, workspace.workflow);
      throw error;
    }
    const ready = this.getStateService().getWorkspace(input.name, workflow.name) ?? workspace;

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
    const workflowName = input.workflow ?? input.machine;
    const workspace = this.resolveWorkspace(input.workspace, workflowName, "remove");
    const workflow = this.getWorkflow(workflowName ?? workspace.workflow);
    if (workspace.workflow !== workflow.name) {
      throw new EngineOperationValidationError({
        operation: "remove",
        message: `Workspace ${workspace.name} belongs to workflow ${workspace.workflow}, not ${workflow.name}`,
      });
    }
    if (!workflow.workspace) {
      throw new Error(`Workflow ${workflow.name} does not define a workspace`);
    }
    const providers = await this.createProviders(workflow.workspace.providerScope);
    await this.requireProviderChecks(workflow.name, providers);
    const metadata: JsonObject = {};
    const runtime = await this.createTaskRuntime({
      workflow,
      providers,
      nodePath: `workspace.${workspace.name}.remove`,
      metadata,
    });
    const draft = cloneWorkspace(workspace);
    const workspaceRuntime = this.createWorkspaceRuntime(draft);

    const removeNodePath = `workspace.${workspace.name}.remove`;
    const workspaceDef = workflow.workspace;
    this.emit({ type: "workspace.remove.started", workspaceName: workspace.name });
    await this.withStepConsole(removeNodePath, () => workspaceDef.remove({
      workflow: {
        name: workflow.name,
        ctx: Object.freeze({ ...workspace.workflowCtx }),
      },
      workspace: workspaceRuntime,
      providers: runtime,
      local: this.local,
      step: this.createStepRuntime(workflow.name, removeNodePath, metadata),
    }));

    this.getStateService().deleteWorkspace(input.workspace, workflow.name);
    this.emit({ type: "workspace.remove.completed", workspaceName: workspace.name });
    return workspace;
  }

  private async evaluate(input: {
    workflow: LoadedWorkflow;
    mode: EvaluationMode;
  }): Promise<{
    context: Record<string, JsonValue>;
    plan: WorkflowPlan;
    fragments: Set<string>;
    cacheExplanations: EngineCacheExplanation[];
  }> {
    const planNodes: WorkflowPlanNode[] = [];
    const cacheExplanations: EngineCacheExplanation[] = [];
    const providerChecks = new Map<string, WorkflowProviderCheck>();
    const providerControllerCache: ProviderControllerCache = new Map();
    const previousEvaluationFragmentHashes = this.evaluationFragmentHashes;
    const fragments = new Set<string>();
    this.evaluationFragmentHashes = fragments;
    let result!: EvaluationResult;
    try {
      result = await this.evaluateNode({
        workflow: input.workflow,
        mode: input.mode,
        node: input.workflow.root,
        cache: {
          scope: "local",
          workflow: input.workflow.name,
          nodePath: "",
          state: this.getStateService(),
        },
        configStack: [],
        state: {
          context: {},
          upstreamRunIds: [],
          previousTasks: [],
          known: true,
        },
        providerControllerCache,
        providerChecks,
        prefix: [],
        cachePrefix: [],
        root: true,
        planNodes,
        cacheExplanations,
        index: { value: 0 },
      });
    } finally {
      this.evaluationFragmentHashes = previousEvaluationFragmentHashes;
    }
    const cachedNodeCount = planNodes.filter((node) => node.status === "cached").length;
    const providerCheckList = [...providerChecks.values()];
    const providerFingerprint = providerPlanFingerprintFor(providerCheckList);
    const plan: WorkflowPlan = {
      workflow: input.workflow.name,
      providerFingerprint,
      ...(providerCheckList.length > 0 ? { providerChecks: providerCheckList } : {}),
      cachedNodeCount,
      nodeCount: planNodes.length,
      nodes: planNodes,
      finalContext: result.known ? result.context : undefined,
    };

    return {
      context: result.context,
      plan,
      fragments,
      cacheExplanations,
    };
  }

  private async evaluateNode(input: EvaluateNodeInput): Promise<EvaluationResult> {
    if (input.node.cacheScope === "global" && input.cache.scope !== "global") {
      const nodePath = nodeDisplayPath(input.node, input.prefix, input.root, input.suppressSequenceName);
      const fragmentHash = globalFragmentHashFor({
        node: input.node,
        definitionSources: this.definitionSources,
      });
      const fragmentState = await this.getGlobalFragmentState({
        hash: fragmentHash,
        workflow: input.workflow.name,
        nodePath,
        nodeName: input.node.name,
        nodeKind: input.node.nodeKind,
      });
      return await this.evaluateNode({
        ...input,
        cache: {
          scope: "global",
          workflow: `fragment:${fragmentHash}`,
          nodePath: "",
          state: fragmentState,
          fragmentHash,
        },
        cachePrefix: [],
        suppressCacheSequenceName: undefined,
      });
    }

    if (input.node.cacheScope === "local" && input.cache.scope !== "local") {
      return await this.evaluateNode({
        ...input,
        cache: {
          scope: "local",
          workflow: input.workflow.name,
          nodePath: "",
          state: this.getStateService(),
        },
        cachePrefix: input.prefix,
        suppressCacheSequenceName: input.suppressSequenceName,
      });
    }

    const configuredInput = input.node.config
      ? { ...input, configStack: [...input.configStack, input.node.config] }
      : input;

    if (configuredInput.node.nodeKind === "task") {
      return await this.evaluateTask(configuredInput as EvaluateNodeInput & { node: WorkflowTaskNode<any, any, any> });
    }

    if (configuredInput.node.nodeKind === "parallel") {
      return await this.evaluateParallel(configuredInput);
    }

    const sequencePrefix = configuredInput.root || configuredInput.suppressSequenceName === configuredInput.node.name
      ? configuredInput.prefix
      : [...configuredInput.prefix, configuredInput.node.name];
    const cacheSequencePrefix = configuredInput.root || configuredInput.suppressCacheSequenceName === configuredInput.node.name
      ? configuredInput.cachePrefix
      : [...configuredInput.cachePrefix, configuredInput.node.name];
    let state = configuredInput.state;

    for (const child of sequenceChildren(configuredInput.node)) {
      const result = await this.evaluateNode({
        ...configuredInput,
        node: child,
        state,
        prefix: sequencePrefix,
        cachePrefix: cacheSequencePrefix,
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

    return { ...state, planNodes: configuredInput.planNodes };
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
        cachePrefix: [...input.cachePrefix, branchName],
        root: false,
        suppressSequenceName: branchName,
        suppressCacheSequenceName: branchName,
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
    const cacheNodePath = [...input.cachePrefix, input.node.name].join(".");
    const upstreamRunIds = [...input.state.upstreamRunIds];
    const nodeKey = hash({
      cache: "task-v6",
      kind: "task",
      path: cacheNodePath,
      name: input.node.name,
      config: input.configStack,
      definitionContext: taskDefinitionContextFingerprintFor(
        this.definitionSources,
        input.node.handler,
      ),
      handler: functionFingerprintFor(input.node.handler),
      output: input.node.options?.output ?? null,
      version: input.node.options?.version ?? null,
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
      input.cacheExplanations.push({
        workflow: input.workflow.name,
        path: nodePath,
        name: input.node.name,
        status: "pending",
        reason: cacheExplainReason("upstream-pending", {
          detail: input.state.blockedReason ?? "upstream output is pending",
        }),
        scope: input.cache.scope,
        cacheWorkflow: input.cache.workflow,
        cacheNodePath,
        upstreamRunIds,
        ...(input.node.options?.cacheTTL !== undefined ? { cacheTTL: input.node.options.cacheTTL } : {}),
        candidates: [],
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

    const providerScope = providerScopeOf(input.node);
    const providers = await this.createProviders(providerScope, input.providerControllerCache);
    const checks = await this.collectProviderChecks(input.workflow.name, providers, {
      mode: input.mode === "plan" ? "plan" : "require",
    });
    for (const check of checks) {
      input.providerChecks.set(providerCheckKey(check), check);
    }
    const providerFingerprint = providerFingerprintFor(providerScope, checks);

    const cached = await this.findReusableTaskRun({
      state: input.cache.state,
      workflow: input.cache.workflow,
      nodePath: cacheNodePath,
      displayNodePath: nodePath,
      nodeKey,
      providerFingerprint,
      upstreamRunIds,
      providers,
      outputSchema: input.node.options?.output,
      cacheTTL: input.node.options?.cacheTTL,
    });

    if (cached) {
      const previousTasks = appendPreviousTask(input.state.previousTasks, {
        name: input.node.name,
        path: nodePath,
        cache: {
          ...input.cache,
          nodePath: cacheNodePath,
        },
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
      input.cacheExplanations.push({
        workflow: input.workflow.name,
        path: nodePath,
        name: input.node.name,
        status: "cached",
        reason: cacheExplainReason("cached"),
        runId: cached.id,
        scope: input.cache.scope,
        cacheWorkflow: input.cache.workflow,
        cacheNodePath,
        upstreamRunIds,
        ...(input.node.options?.cacheTTL !== undefined ? { cacheTTL: input.node.options.cacheTTL } : {}),
        candidates: [
          cacheExplainCandidateForRun(cached, input.cache, nodePath, [cacheExplainReason("cached")]),
        ],
      });
      return {
        context: cached.output,
        upstreamRunIds: [cached.id],
        previousTasks,
        known: true,
        planNodes: input.planNodes,
      };
    }

    const cacheExplanation = await this.explainTaskCacheDecision({
      workflow: input.workflow.name,
      displayNodePath: nodePath,
      nodeName: input.node.name,
      state: input.cache.state,
      cache: input.cache,
      cacheNodePath,
      nodeKey,
      providerFingerprint,
      upstreamRunIds,
      providers,
      outputSchema: input.node.options?.output,
      cacheTTL: input.node.options?.cacheTTL,
    });
    input.cacheExplanations.push(cacheExplanation);

    input.planNodes.push({
      index: planIndex,
      path: nodePath,
      name: input.node.name,
      status: "pending",
      reason: cacheExplanation.reason.message,
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
      providers,
      nodePath,
      metadata,
    });
    const config = Object.freeze(mergeConfigStack(input.configStack));
    const step = this.createStepRuntime(
      input.workflow.name,
      nodePath,
      metadata,
      input.state.context,
      input.state.previousTasks,
    );
    const result = await this.withStepConsole(nodePath, () => input.node.handler({
      providers: runtime,
      step,
      config,
    }));
    if (isStepInvalidation(result)) {
      const targetTask = input.state.previousTasks.find((task) => task.path === result.targetNodePath);
      const invalidatedRunIds = targetTask
        ? this.invalidateTaskCaches([
          targetTask.cache,
          {
            ...input.cache,
            nodePath: cacheNodePath,
          },
        ])
        : this.invalidateTaskCaches([{
          ...input.cache,
          nodePath: cacheNodePath,
        }]);
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
      workflow: input.cache.workflow,
      nodePath: cacheNodePath,
      nodeName: input.node.name,
      nodeKind: input.node.nodeKind,
      nodeKey,
      providerFingerprint,
      upstreamRunIds,
      output,
      artifacts,
      invalidated: false,
      createdAt: new Date().toISOString(),
      metadata,
    };

    input.cache.state.saveNodeRun(record);
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
      cache: {
        ...input.cache,
        nodePath: cacheNodePath,
      },
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
    state: StateService;
    workflow: string;
    nodePath: string;
    displayNodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
    providers: ProviderControllers;
    outputSchema?: OutputSchema;
    cacheTTL?: WorkflowTaskCacheTTL;
  }): Promise<WorkflowNodeRunRecord | undefined> {
    const cached = input.state.findReusableNodeRun(input);
    if (!cached) return undefined;
    if (!isCacheFresh(cached.createdAt, input.cacheTTL)) return undefined;

    const parsed = normalizeTaskOutput(input.displayNodePath, cached.output, input.outputSchema, "cached");
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

  private async explainTaskCacheDecision(input: {
    workflow: string;
    displayNodePath: string;
    nodeName: string;
    state: StateService;
    cache: EvaluationCacheTarget;
    cacheNodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
    providers: ProviderControllers;
    outputSchema?: OutputSchema;
    cacheTTL?: WorkflowTaskCacheTTL;
  }): Promise<EngineCacheExplanation> {
    const runs = input.state.listNodeRuns()
      .filter((run) => run.workflow === input.cache.workflow && run.nodePath === input.cacheNodePath);
    const candidates = await Promise.all(
      runs.map(async (run) =>
        cacheExplainCandidateForRun(
          run,
          input.cache,
          input.displayNodePath,
          await this.cacheMissReasonsForRun({
            run,
            displayNodePath: input.displayNodePath,
            nodeKey: input.nodeKey,
            providerFingerprint: input.providerFingerprint,
            upstreamRunIds: input.upstreamRunIds,
            providers: input.providers,
            outputSchema: input.outputSchema,
            cacheTTL: input.cacheTTL,
          }),
        )
      ),
    );

    return {
      workflow: input.workflow,
      path: input.displayNodePath,
      name: input.nodeName,
      status: "pending",
      reason: summarizeCacheMiss(candidates),
      scope: input.cache.scope,
      cacheWorkflow: input.cache.workflow,
      cacheNodePath: input.cacheNodePath,
      upstreamRunIds: [...input.upstreamRunIds],
      ...(input.cacheTTL !== undefined ? { cacheTTL: input.cacheTTL } : {}),
      candidates,
    };
  }

  private async cacheMissReasonsForRun(input: {
    run: WorkflowNodeRunRecord;
    displayNodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
    providers: ProviderControllers;
    outputSchema?: OutputSchema;
    cacheTTL?: WorkflowTaskCacheTTL;
  }): Promise<EngineCacheExplainReason[]> {
    const run = input.run;
    if (run.invalidated) return [cacheExplainReason("invalidated")];
    if (run.nodeKey !== input.nodeKey) return [cacheExplainReason("task-changed")];
    if (run.providerFingerprint !== input.providerFingerprint) return [cacheExplainReason("provider-changed")];
    if (stableJson(run.upstreamRunIds) !== stableJson([...input.upstreamRunIds])) {
      return [cacheExplainReason("upstream-changed")];
    }
    if (!isCacheFresh(run.createdAt, input.cacheTTL)) {
      return [cacheExplainReason("expired", { detail: `created ${run.createdAt}` })];
    }

    const parsed = normalizeTaskOutput(input.displayNodePath, run.output, input.outputSchema, "cached");
    if (!parsed) return [cacheExplainReason("output-schema-invalid")];

    for (const artifact of run.artifacts) {
      const providerId = providerIdOf(artifact);
      if (!providerId) return [cacheExplainReason("artifact-invalid", { detail: "artifact is missing provider id" })];
      const provider = Object.values(input.providers).find((controller) => controller.providerId === providerId);
      if (provider?.validateArtifact && !await provider.validateArtifact(artifact)) {
        return [cacheExplainReason("artifact-invalid", { detail: `${providerId} artifact validation failed` })];
      }
    }

    return [cacheExplainReason("unknown")];
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

    const createNodePath = `workspace.${input.name}.create`;
    const workspaceDef = input.workflow.workspace;
    try {
      const data = await this.withStepConsole(createNodePath, () => workspaceDef.create({
        workflow: {
          name: input.workflow.name,
          ctx: Object.freeze({ ...input.context }),
        },
        workspace: {
          name: input.name,
        },
        providers,
        local: this.local,
        step: this.createStepRuntime(input.workflow.name, createNodePath, metadata),
      }));
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
    await this.requireProviderChecks(input.workflow.name, input.providers);
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

    const workspaceOperationNodePath = `workspace.${input.workspace.name}.${input.operation.id}`;
    this.emit({
      type: "workspace.operation.started",
      workspaceName: input.workspace.name,
      operationId: input.operation.id,
    });
    const result = await this.withStepConsole(workspaceOperationNodePath, () => input.operation.run({
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
        workspaceOperationNodePath,
        metadata,
      ),
    }));
    if (result !== undefined) assertJsonValue(result, `Workspace operation ${input.operation.id} result`);
    this.emit({
      type: "workspace.operation.completed",
      workspaceName: input.workspace.name,
      operationId: input.operation.id,
    });
    return result ?? null;
  }

  private createWorkspaceRuntime<Data extends object>(draft: WorkspaceRecord): WorkspaceRuntimeRecord<Data> {
    return Object.freeze({
      name: draft.name,
      ctx: Object.freeze({ ...draft.ctx }) as Data,
    }) as WorkspaceRuntimeRecord<Data>;
  }

  // Wraps a user step handler in an AsyncLocalStorage scope so that any
  // console.log / debug / warn / error invoked inside (transitively, through
  // any helper or third-party SDK) is captured and emitted as a log.output
  // event tied to this step's node path.
  private withStepConsole<T>(nodePath: string, fn: () => Promise<T> | T): Promise<T> | T {
    const sink: StepConsoleSink = ({ level, message }) => {
      this.emit({
        type: "log.output",
        nodePath,
        stream: consoleLevelToLogStream(level),
        data: message,
      });
    };
    return runWithStepConsole(sink, fn);
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
      invalidate: <Target extends string>(target: Target): never => {
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
        } as never;
      },
    };
  }

  private resolveWorkspace(name: string, workflowName: string | undefined, operation: string): WorkspaceRecord {
    if (workflowName) {
      const workspace = this.getStateService().getWorkspace(name, workflowName);
      if (!workspace) throw new Error(`Unknown workspace ${name} in workflow ${workflowName}`);
      return workspace;
    }

    const matches = this.getStateService().listWorkspacesByName(name);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new EngineOperationValidationError({
        operation,
        message: `Workspace ${name} exists in multiple workflows: ${matches.map((item) => item.workflow).join(", ")}. Pass --workflow to choose one.`,
      });
    }
    throw new Error(`Unknown workspace ${name}`);
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

    throw new Error(`Pass --workflow to choose a workflow`);
  }

  private findRuntimeOperationEntry(operationId: string, workflowName: string | undefined): RuntimeOperationEntry | undefined {
    const matches = this.listRuntimeOperationEntries().filter((entry) =>
      entry.summary.id === operationId || entry.summary.aliases?.includes(operationId)
    );
    if (workflowName) {
      return matches.find((entry) => entry.summary.workflow === "" || entry.summary.workflow === workflowName);
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Multiple workflows define operation ${operationId}; pass --workflow`);
    return undefined;
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
    operation: {
      id: string;
      input?: WorkflowOperationInputSchema<any> | { fields: readonly WorkflowInputFieldDefinition[] };
    },
    value: unknown,
  ): Record<string, unknown> {
    const raw = isPlainObject(value) ? value : {};
    if (operation.input && isOperationInputSchema(operation.input)) {
      try {
        const parsed = operation.input.parse(raw);
        if (!isPlainObject(parsed)) {
          throw new Error(`Operation ${operation.id} input schema must parse to an object`);
        }
        return parsed as Record<string, unknown>;
      } catch (error) {
        if (error instanceof EngineOperationValidationError) throw error;
        throw new EngineOperationValidationError({
          operation: operation.id,
          message: `Invalid input for operation ${operation.id}: ${formatOperationInputError(error)}`,
          cause: error,
        });
      }
    }

    const fields = operation.input && "fields" in operation.input ? operation.input.fields : [];
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
        const workspace = this.getStateService().findWorkspace(rawValue, workflow.name);
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
      throw new Error(`No workflow state loaded. Call engine.load() first.`);
    }
    return this.state;
  }

  private async getGlobalFragmentState(input: GlobalFragmentStateLocationInput): Promise<StateService> {
    this.evaluationFragmentHashes?.add(input.hash);
    const existing = this.globalFragmentStates.get(input.hash);
    if (existing) return existing.state;

    const state = this.stateFactory({
      projectDir: this.projectDir,
      configPath: this.configPath,
      scope: `fragment:${input.hash}`,
      source: {
        kind: "global-fragment",
        hash: input.hash,
        workflow: input.workflow,
        nodePath: input.nodePath,
        nodeName: input.nodeName,
        nodeKind: input.nodeKind,
      },
    });
    this.globalFragmentStates.set(input.hash, { input, state });
    return state;
  }

  private invalidateTaskCaches(targets: EvaluationCacheTarget[]): string[] {
    const grouped = new Map<string, { target: EvaluationCacheTarget; nodePaths: Set<string> }>();
    for (const target of targets) {
      const key = `${target.state.id}\0${target.workflow}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.nodePaths.add(target.nodePath);
      } else {
        grouped.set(key, { target, nodePaths: new Set([target.nodePath]) });
      }
    }

    return [...grouped.values()].flatMap(({ target, nodePaths }) =>
      target.state.invalidateNodeRuns({
        workflow: target.workflow,
        nodePaths: [...nodePaths],
      })
    );
  }

  private invalidateCacheTargets(targets: CacheInvalidateTarget[], localWorkflow: string): number {
    const grouped = new Map<string, {
      state: StateService;
      workflow: string;
      nodePaths: Set<string>;
    }>();
    for (const target of targets) {
      const state = target.scope === "global"
        ? target.fragmentHash
          ? this.globalFragmentStates.get(target.fragmentHash)?.state
          : undefined
        : this.getStateService();
      if (!state) continue;

      const workflow = target.scope === "global" && target.fragmentHash
        ? `fragment:${target.fragmentHash}`
        : localWorkflow;
      const key = `${state.id}\0${workflow}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.nodePaths.add(target.nodePath);
      } else {
        grouped.set(key, { state, workflow, nodePaths: new Set([target.nodePath]) });
      }
    }

    let invalidated = 0;
    for (const group of grouped.values()) {
      invalidated += group.state.invalidateNodeRuns({
        workflow: group.workflow,
        nodePaths: [...group.nodePaths],
      }).length;
    }
    return invalidated;
  }

  private async createProviders(
    providerScope: LoadedProviderScope | undefined,
    cache: ProviderControllerCache = new Map(),
  ): Promise<ProviderControllers> {
    const scope = providerScope ?? {};
    const entries = await Promise.all(
      Object.entries(scope).map(async ([name, provider]) => {
        const key = providerControllerCacheKey(name, provider);
        let controller = cache.get(key);
        if (!controller) {
          controller = await this.providerFactory({
            provider,
            storage: this.getStateService().providerStorage(provider.providerId),
            hostStorage: this.getProviderHostStorage(provider.providerId),
            local: this.local,
          });
          cache.set(key, controller);
        }
        return [name, controller] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  private async collectProviderChecks(
    workflow: string,
    providers: ProviderControllers,
    input: { mode: "plan" | "require" },
  ): Promise<WorkflowProviderCheck[]> {
    const checks = await Promise.all(
      Object.entries(providers).map(async ([providerName, controller]) => {
        const result = await controller.checks?.({
          mode: input.mode,
          workflow,
          local: this.local,
        });
        return normalizeProviderChecks(result).map((check) => ({
          providerId: check.providerId ?? controller.providerId,
          providerName: check.providerName ?? providerName,
          id: check.id,
          label: check.label,
          status: check.status,
          value: check.value,
          ...(check.message ? { message: check.message } : {}),
          ...(check.detail ? { detail: check.detail } : {}),
          ...(check.fingerprint ? { fingerprint: check.fingerprint } : {}),
          ...(check.metadata ? { metadata: check.metadata } : {}),
        }));
      }),
    );
    const flatChecks = checks.flat();
    if (input.mode === "require") {
      const required = flatChecks.find((check) => check.status !== "ok");
      if (required) {
        throw new Error(
          `Provider check required: ${required.label}${required.message ? `. ${required.message}` : ""}`,
        );
      }
    }
    return flatChecks;
  }

  private async requireProviderChecks(workflow: string, providers: ProviderControllers): Promise<void> {
    await this.collectProviderChecks(workflow, providers, { mode: "require" });
  }

  private async createProviderFromPlugin(input: Parameters<ProviderFactory>[0]): Promise<WorkflowProviderController> {
    const plugin = this.providers.find((provider) => provider.providerId === input.provider.providerId);
    if (!plugin) {
      throw new Error(
        `Provider ${input.provider.providerId} does not implement the Stoke workflow provider contract. ` +
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
    const resolvedRoot = await resolveWorkflowNode(root);
    const providers = collectLoadedProviderSummary(resolvedRoot);

    return {
      name: root.workflow.name,
      providers,
      root: resolvedRoot,
      workspace: resolvedRoot.workspaceDefinition,
      operations: resolvedRoot.operations ?? [],
      workspaceOperations: resolvedRoot.workspaceOperations ?? [],
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
    operations: workspace.operations.map((operation) => structuredClone(operation)),
    ...(workspace.createdFrom ? { createdFrom: { ...workspace.createdFrom } } : {}),
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

function workflowNameFromInput(input: unknown): string | undefined {
  if (!isPlainObject(input)) return undefined;
  return typeof input.workflow === "string" ? input.workflow : undefined;
}

const workspaceNamePattern = /^(?!-)[A-Za-z0-9._-]+$/;

function assertValidWorkspaceName(value: string): void {
  if (!value) throw new Error(`create requires a workspace name`);
  if (!workspaceNamePattern.test(value)) {
    throw new Error(
      `Workspace name "${value}" is invalid. Use only letters, numbers, ".", "_", and "-", and do not start with "-".`,
    );
  }
}

async function resolveProviderDefinition(
  definition: WorkflowProviderDefinition,
): Promise<LoadedProviderDefinition> {
  return {
    providerId: definition.providerId,
    config: await resolveConfigObject(definition.config),
    plugin: definition.plugin,
  };
}

async function resolveProviderScope(scope: WorkflowProviderMap | undefined): Promise<LoadedProviderScope> {
  const providers: LoadedProviderScope = {};
  for (const [name, definition] of Object.entries(scope ?? {})) {
    if (!isProviderDefinition(definition)) {
      throw new Error(`Provider ${name} is not a valid Stoke provider`);
    }
    providers[name] = await resolveProviderDefinition(definition);
  }
  return providers;
}

async function resolveWorkflowNode(
  node: WorkflowNodeDefinition<any, any, any>,
): Promise<WorkflowNodeDefinition<any, any, any>> {
  const providerScope = await resolveProviderScope(node.providerScope as WorkflowProviderMap | undefined);
  const workspaceDefinition = node.workspaceDefinition
    ? {
      ...node.workspaceDefinition,
      providerScope: await resolveProviderScope(
        node.workspaceDefinition.providerScope as WorkflowProviderMap | undefined,
      ),
    }
    : undefined;
  const operations = await Promise.all((node.operations ?? []).map(async (operation) => ({
    ...operation,
    providerScope: await resolveProviderScope(operation.providerScope as WorkflowProviderMap | undefined),
  })));
  const workspaceOperations = await Promise.all((node.workspaceOperations ?? []).map(async (operation) => ({
    ...operation,
    providerScope: await resolveProviderScope(operation.providerScope as WorkflowProviderMap | undefined),
  })));

  if (node.nodeKind === "parallel") {
    return {
      ...node,
      providerScope,
      ...(workspaceDefinition ? { workspaceDefinition } : {}),
      operations,
      workspaceOperations,
      branches: Object.fromEntries(
        await Promise.all(
          Object.entries(parallelBranches(node)).map(async ([name, branch]) => [
            name,
            await resolveWorkflowNode(branch),
          ] as const),
        ),
      ),
    } as WorkflowNodeDefinition<any, any, any>;
  }

  if (node.nodeKind === "sequence") {
    return {
      ...node,
      providerScope,
      ...(workspaceDefinition ? { workspaceDefinition } : {}),
      operations,
      workspaceOperations,
      children: await Promise.all(sequenceChildren(node).map((child) => resolveWorkflowNode(child))),
    } as WorkflowNodeDefinition<any, any, any>;
  }

  return {
    ...node,
    providerScope,
    ...(workspaceDefinition ? { workspaceDefinition } : {}),
    operations,
    workspaceOperations,
  };
}

function collectProviderDefinitions(root: WorkflowNodeDefinition<any, any, any>): WorkflowProviderDefinition[] {
  const providers: WorkflowProviderDefinition[] = [];
  visit(root);
  return providers;

  function collect(scope: unknown): void {
    if (!scope || typeof scope !== "object") return;
    for (const provider of Object.values(scope as Record<string, unknown>)) {
      if (isProviderDefinition(provider)) providers.push(provider);
    }
  }

  function visit(node: WorkflowNodeDefinition<any, any, any>): void {
    collect(node.providerScope);
    collect(node.workspaceDefinition?.providerScope);
    for (const operation of node.operations ?? []) collect(operation.providerScope);
    for (const operation of node.workspaceOperations ?? []) collect(operation.providerScope);
    if (node.nodeKind === "sequence") {
      for (const child of sequenceChildren(node)) visit(child);
    } else if (node.nodeKind === "parallel") {
      for (const branch of Object.values(parallelBranches(node))) visit(branch);
    }
  }
}

function collectLoadedProviderSummary(root: WorkflowNodeDefinition<any, any, any>): LoadedProviderScope {
  const providers: LoadedProviderScope = {};
  visit(root);
  return providers;

  function collect(scope: LoadedProviderScope | undefined): void {
    for (const [name, provider] of Object.entries(scope ?? {})) {
      providers[name] = provider;
    }
  }

  function visit(node: WorkflowNodeDefinition<any, any, any>): void {
    collect(providerScopeOf(node));
    collect(node.workspaceDefinition?.providerScope as LoadedProviderScope | undefined);
    for (const operation of node.operations ?? []) collect(operation.providerScope as LoadedProviderScope | undefined);
    for (const operation of node.workspaceOperations ?? []) {
      collect(operation.providerScope as LoadedProviderScope | undefined);
    }
    if (node.nodeKind === "sequence") {
      for (const child of sequenceChildren(node)) visit(child);
    } else if (node.nodeKind === "parallel") {
      for (const branch of Object.values(parallelBranches(node))) visit(branch);
    }
  }
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

function normalizeDefinitions(mod: Record<string, unknown>): WorkflowNodeDefinition<any, any, any>[] {
  if (isPlainObject(mod.workflows)) {
    const workflows = Object.entries(mod.workflows);
    if (workflows.length === 0) throw new Error(`stoke/index.ts workflows export must not be empty`);
    return workflows.map(([name, value]) => {
      if (!isWorkflowNode(value)) {
        throw new Error(`stoke/index.ts workflows.${name} must be a workflow node`);
      }
      return value;
    });
  }

  const workflows = Object.entries(mod)
    .filter(([name, value]) => name !== "default" && name !== "workflow" && isWorkflowNode(value))
    .map(([, value]) => value as WorkflowNodeDefinition<any, any, any>);
  if (workflows.length === 0) {
    throw new Error(`stoke/index.ts must export workflow nodes, for example: export const dev = workflow("dev", ...).step(...)`);
  }
  return workflows;
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

function summarizeWorkflow(workflow: LoadedWorkflow, lastApply?: WorkflowApplyRecord): WorkflowSummary {
  return {
    name: workflow.name,
    providers: Object.entries(workflow.providers).map(([name, provider]) => `${name}:${provider.providerId}`),
    nodes: collectNodePaths(workflow.root),
    operations: workflow.operations.map((operation) => operation.id),
    createsWorkspace: Boolean(workflow.workspace),
    ...(lastApply
      ? {
        lastAppliedAt: lastApply.appliedAt,
        lastAppliedCachedNodeCount: lastApply.cachedNodeCount,
        lastAppliedNodeCount: lastApply.nodeCount,
      }
      : {}),
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

function providerFingerprintFor(providerScope: LoadedProviderScope, providerChecks: WorkflowProviderCheck[]): string {
  return hash({
    cache: "provider-v4",
    providers: Object.fromEntries(
      Object.entries(providerScope).map(([name, provider]) => [
        name,
        {
          providerId: provider.providerId,
          config: provider.config,
          plugin: providerPluginFingerprint(provider.plugin),
        },
      ]),
    ),
    checks: providerChecks.map((check) => ({
      providerName: check.providerName,
      providerId: check.providerId,
      id: check.id,
      status: check.status,
      fingerprint: check.fingerprint ?? check.value,
    })),
  });
}

function providerPlanFingerprintFor(providerChecks: WorkflowProviderCheck[]): string {
  return hash({
    cache: "provider-plan-v1",
    checks: providerChecks.map((check) => ({
      providerName: check.providerName,
      providerId: check.providerId,
      id: check.id,
      status: check.status,
      fingerprint: check.fingerprint ?? check.value,
    })),
  });
}

function providerPluginFingerprint(plugin: unknown): unknown {
  if (!isBaseProviderPlugin(plugin)) return null;
  return {
    providerId: plugin.providerId,
    capabilities: plugin.capabilities ?? [],
    createProvider: functionFingerprintFor(plugin.createProvider),
  };
}

function requiredCapabilitiesForScope(
  scope: WorkflowProviderMap | LoadedProviderScope | undefined,
): readonly HostCapabilityRequirement[] {
  const capabilities = new Map<string, HostCapabilityRequirement>();
  for (const provider of Object.values(scope ?? {})) {
    const plugin = provider.plugin;
    if (!isBaseProviderPlugin(plugin)) continue;
    for (const capability of plugin.capabilities ?? []) {
      const existing = capabilities.get(capability.id);
      if (
        existing?.schemaHash && capability.schemaHash &&
        existing.schemaHash !== capability.schemaHash
      ) {
        throw new Error(
          `Host capability ${capability.id} has conflicting schema hashes ` +
            `${existing.schemaHash} and ${capability.schemaHash}`,
        );
      }
      const schemaHash = capability.schemaHash ?? existing?.schemaHash;
      capabilities.set(capability.id, {
        id: capability.id,
        ...(schemaHash ? { schemaHash } : {}),
      });
    }
  }
  return [...capabilities.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function providerScopeOf(node: WorkflowNodeDefinition<any, any, any>): LoadedProviderScope {
  return (node.providerScope ?? {}) as LoadedProviderScope;
}

function providerCheckKey(check: WorkflowProviderCheck): string {
  return `${check.providerName}\0${check.providerId}\0${check.id}`;
}

function providerControllerCacheKey(name: string, provider: LoadedProviderDefinition): string {
  return hash({
    cache: "provider-controller-v1",
    name,
    providerId: provider.providerId,
    config: provider.config,
    plugin: providerPluginFingerprint(provider.plugin),
  });
}

function globalFragmentHashFor(input: {
  node: WorkflowNodeDefinition<any, any, any>;
  definitionSources: readonly DefinitionSourceFile[];
}): string {
  return `sha256-${hash({
    cache: "fragment-v2",
    graph: graphFingerprintFor(input.node, input.definitionSources),
  })}`;
}

function graphFingerprintFor(
  node: WorkflowNodeDefinition<any, any, any>,
  definitionSources?: readonly DefinitionSourceFile[],
): unknown {
  if (node.nodeKind === "task") {
    const task = node as WorkflowTaskNode<any, any, any>;
    return {
      kind: "task",
      name: task.name,
      scope: task.cacheScope ?? null,
      config: task.config ?? null,
      definitionContext: definitionSources
        ? taskDefinitionContextFingerprintFor(definitionSources, task.handler)
        : null,
      handler: functionFingerprintFor(task.handler),
      output: task.options?.output ?? null,
      cacheTTL: task.options?.cacheTTL ?? null,
      version: task.options?.version ?? null,
    };
  }

  if (node.nodeKind === "parallel") {
    return {
      kind: "parallel",
      name: node.name,
      scope: node.cacheScope ?? null,
      config: node.config ?? null,
      branches: Object.fromEntries(
        Object.entries(parallelBranches(node)).map(([name, branch]) => [
          name,
          graphFingerprintFor(branch, definitionSources),
        ]),
      ),
    };
  }

  return {
    kind: "sequence",
    name: node.name,
    scope: node.cacheScope ?? null,
    config: node.config ?? null,
    children: sequenceChildren(node).map((child) =>
      graphFingerprintFor(child, definitionSources)
    ),
  };
}

function nodeDisplayPath(
  node: WorkflowNodeDefinition<any, any, any>,
  prefix: string[],
  root: boolean,
  suppressSequenceName?: string,
): string {
  if (node.nodeKind === "task") return [...prefix, node.name].join(".");
  if (node.nodeKind === "sequence") {
    return (root || suppressSequenceName === node.name ? prefix : [...prefix, node.name]).join(".");
  }
  return [...prefix, node.name].join(".");
}

function cacheExplainReason(
  code: EngineCacheExplainReasonCode,
  options: { detail?: string } = {},
): EngineCacheExplainReason {
  return {
    code,
    message: cacheExplainReasonMessage(code),
    ...(options.detail ? { detail: options.detail } : {}),
  };
}

function cacheExplainReasonMessage(code: EngineCacheExplainReasonCode): string {
  switch (code) {
    case "cached":
      return "cached";
    case "upstream-pending":
      return "upstream output is pending";
    case "no-previous-run":
      return "no previous run";
    case "invalidated":
      return "cache entry was invalidated";
    case "task-changed":
      return "task definition changed";
    case "provider-changed":
      return "provider fingerprint changed";
    case "upstream-changed":
      return "upstream run ids changed";
    case "expired":
      return "cacheTTL expired";
    case "output-schema-invalid":
      return "cached output no longer matches the output schema";
    case "artifact-invalid":
      return "cached artifact is no longer valid";
    case "unknown":
      return "no reusable node run";
  }
}

function cacheExplainCandidateForRun(
  run: WorkflowNodeRunRecord,
  cache: EvaluationCacheTarget,
  displayPath: string,
  reasons: EngineCacheExplainReason[],
): EngineCacheExplainCandidate {
  return {
    runId: run.id,
    scope: cache.scope,
    nodePath: run.nodePath,
    displayPath,
    nodeName: run.nodeName,
    nodeKind: run.nodeKind,
    createdAt: run.createdAt,
    invalidated: run.invalidated,
    ...(cache.scope === "global" && cache.fragmentHash ? { fragmentHash: cache.fragmentHash } : {}),
    reasons,
  };
}

function summarizeCacheMiss(candidates: readonly EngineCacheExplainCandidate[]): EngineCacheExplainReason {
  if (candidates.length === 0) return cacheExplainReason("no-previous-run");
  return candidates[0]?.reasons[0] ?? cacheExplainReason("unknown");
}

function resolveCacheExplainTargets(
  target: string,
  explanations: readonly EngineCacheExplanation[],
): EngineCacheExplanation[] {
  const exactMatches = explanations.filter((entry) =>
    entry.path === target || entry.cacheNodePath === target
  );
  const matches = exactMatches.length > 0
    ? exactMatches
    : explanations.filter((entry) => entry.name === target);

  if (matches.length === 0) throw new Error(`Unknown cache task ${target}`);
  if (matches.length > 1) {
    const labels = matches.map((entry) => entry.path).join(", ");
    throw new Error(`Task ${target} matches multiple tasks: ${labels}`);
  }
  return matches;
}

function cacheEntryForRun(
  run: WorkflowNodeRunRecord,
  scope: WorkflowCacheScope,
  fragmentHash?: string,
  workflow?: string,
  planNode?: WorkflowPlanNode,
): EngineCacheEntry {
  return {
    scope,
    workflow: workflow ?? run.workflow,
    nodePath: run.nodePath,
    ...(planNode ? { displayPath: planNode.path, planIndex: planNode.index } : {}),
    nodeName: run.nodeName,
    nodeKind: run.nodeKind,
    runId: run.id,
    invalidated: run.invalidated,
    createdAt: run.createdAt,
    ...(fragmentHash ? { fragmentHash } : {}),
  };
}

function compareCacheEntries(left: EngineCacheEntry, right: EngineCacheEntry): number {
  const leftIndex = left.planIndex ?? Number.POSITIVE_INFINITY;
  const rightIndex = right.planIndex ?? Number.POSITIVE_INFINITY;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  if (left.nodePath !== right.nodePath) return left.nodePath.localeCompare(right.nodePath);
  return right.createdAt.localeCompare(left.createdAt);
}

function resolveCacheInvalidateTargets(
  targets: readonly string[],
  entries: readonly EngineCacheEntry[],
): CacheInvalidateTarget[] {
  const resolved: CacheInvalidateTarget[] = [];
  for (const target of targets) {
    const exactMatches = entries.filter((entry) =>
      entry.nodePath === target || entry.displayPath === target
    );
    const matches = exactMatches.length > 0
      ? exactMatches
      : entries.filter((entry) => entry.nodeName === target);
    if (matches.length === 0) {
      resolved.push({ scope: "local", nodePath: target });
      continue;
    }

    const invalidateTargets = uniqueCacheInvalidateTargets(matches.map(cacheInvalidateTargetForEntry));
    if (invalidateTargets.length > 1) {
      const labels = [...new Set(matches.map((entry) => entry.displayPath ?? entry.nodePath))].join(", ");
      throw new Error(`Task ${target} matches multiple cached tasks: ${labels}`);
    }
    resolved.push(invalidateTargets[0]!);
  }
  return uniqueCacheInvalidateTargets(resolved);
}

function cacheInvalidateTargetForEntry(entry: EngineCacheEntry): CacheInvalidateTarget {
  return {
    scope: entry.scope,
    nodePath: entry.nodePath,
    ...(entry.scope === "global" && entry.fragmentHash ? { fragmentHash: entry.fragmentHash } : {}),
  };
}

function uniqueCacheInvalidateTargets(targets: readonly CacheInvalidateTarget[]): CacheInvalidateTarget[] {
  const seen = new Set<string>();
  const unique: CacheInvalidateTarget[] = [];
  for (const target of targets) {
    const key = `${target.scope}\0${target.fragmentHash ?? ""}\0${target.nodePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

function mergeConfigStack(configStack: readonly JsonObject[]): JsonObject {
  return Object.assign({}, ...configStack);
}

function functionFingerprintFor(fn: Function): { name: string; length: number; source: string } {
  return {
    name: fn.name,
    length: fn.length,
    source: Function.prototype.toString.call(fn),
  };
}

function taskDefinitionContextFingerprintFor(
  sources: readonly DefinitionSourceFile[],
  fn: Function,
): string {
  return hash({
    cache: "definition-dependencies-v1",
    dependencies: collectDefinitionDependencySnippets(
      sources,
      identifiersIn(Function.prototype.toString.call(fn)),
    ),
  });
}

const jsReservedWords = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function identifiersIn(source: string): Set<string> {
  const identifiers = new Set<string>();
  const identifierPattern = /\b[$A-Z_a-z][$\w]*\b/g;
  for (const match of source.matchAll(identifierPattern)) {
    const name = match[0];
    const index = match.index ?? 0;
    if (jsReservedWords.has(name)) continue;
    if (source[index - 1] === ".") continue;
    identifiers.add(name);
  }
  return identifiers;
}

function collectDefinitionDependencySnippets(
  sources: readonly DefinitionSourceFile[],
  initialIdentifiers: Iterable<string>,
): { path: string; name: string; source: string }[] {
  const queue = [...initialIdentifiers];
  const seen = new Set<string>();
  const snippets: { path: string; name: string; source: string }[] = [];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);

    const snippet = findDefinitionSnippet(sources, name);
    if (!snippet) continue;
    snippets.push(snippet);

    for (const dependency of identifiersIn(snippet.source)) {
      if (!seen.has(dependency)) queue.push(dependency);
    }
  }

  return snippets.sort((a, b) =>
    a.path === b.path ? a.name.localeCompare(b.name) : a.path.localeCompare(b.path)
  );
}

function findDefinitionSnippet(
  sources: readonly DefinitionSourceFile[],
  name: string,
): { path: string; name: string; source: string } | undefined {
  for (const file of sources) {
    const source = variableDeclarationSnippet(file.source, name)
      ?? functionOrClassDeclarationSnippet(file.source, name)
      ?? importDeclarationSnippet(file.source, name);
    if (source) return { path: file.path, name, source };
  }
  return undefined;
}

function variableDeclarationSnippet(source: string, name: string): string | undefined {
  return declarationSnippet(
    source,
    new RegExp(`(^|\\n)([ \\t]*(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(name)}\\b)`),
  );
}

function functionOrClassDeclarationSnippet(source: string, name: string): string | undefined {
  return declarationSnippet(
    source,
    new RegExp(`(^|\\n)([ \\t]*(?:export\\s+)?(?:async\\s+)?(?:function|class)\\s+${escapeRegExp(name)}\\b)`),
  );
}

function declarationSnippet(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  if (!match) return undefined;
  const start = (match.index ?? 0) + match[1]!.length;
  const next = /\n[ \t]*(?:export\s+)?(?:const|let|var|async\s+function|function|class)\s+/.exec(
    source.slice(start + 1),
  );
  const end = next ? start + 1 + next.index : source.length;
  return source.slice(start, end).trim();
}

function importDeclarationSnippet(source: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const importLine = new RegExp(`(^|\\n)([^\\n]*\\bimport\\b[^\\n]*\\b${escaped}\\b[^\\n]*)`).exec(source);
  return importLine?.[2]?.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
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
    `Config operation "${operationId}" conflicts with a reserved Stoke host command. ` +
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

function normalizeProviderChecks(
  result: WorkflowProviderCheckResult | WorkflowProviderCheckResult[] | undefined,
): WorkflowProviderCheckResult[] {
  if (result === undefined) return [];
  return Array.isArray(result) ? result : [result];
}

function isOperationInputSchema(value: unknown): value is WorkflowOperationInputSchema<any> {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { parse?: unknown }).parse === "function" &&
      typeof (value as { toJSONSchema?: unknown }).toJSONSchema === "function",
  );
}

function operationInputJsonSchema(operation: {
  id: string;
  input?: WorkflowOperationInputSchema<any>;
}): Record<string, unknown> {
  if (!operation.input) return {};
  try {
    const schema = operation.input.toJSONSchema({
      target: "draft-07",
      io: "input",
      unrepresentable: "any",
    });
    if (!isPlainObject(schema)) {
      throw new Error(`Operation ${operation.id} input schema must render to a JSON Schema object`);
    }
    return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to render input schema for operation ${operation.id}`, { cause: error });
  }
}

function formatOperationInputError(error: unknown): string {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path?: unknown[]; message?: unknown }> }).issues;
    return issues
      .map((issue) => {
        const path = Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${String(issue.message ?? "invalid value")}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
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

async function showLocalMessage(input: { message: string; level?: "info" | "warn" | "error" }): Promise<void> {
  const writer = input.level === "error" || input.level === "warn" ? console.error : console.log;
  writer(input.message);
}

async function promptLocalText(input: { message: string; defaultValue?: string }): Promise<string> {
  if (input.defaultValue !== undefined) return input.defaultValue;
  throw new Error(`Host text prompt requires an interactive runtime host: ${input.message}`);
}

async function confirmLocalPrompt(input: { message: string; defaultValue?: boolean }): Promise<boolean> {
  if (input.defaultValue !== undefined) return input.defaultValue;
  throw new Error(`Host confirm prompt requires an interactive runtime host: ${input.message}`);
}

async function selectLocalOption(input: {
  message: string;
  options: Array<{ value: string; label?: string; description?: string }>;
  defaultValue?: string;
}): Promise<string> {
  if (input.defaultValue) return input.defaultValue;
  throw new Error(`Host select prompt requires an interactive runtime host: ${input.message}`);
}

async function requestUnsupportedHostCapability<Result = unknown>(capability: string): Promise<Result> {
  throw new Error(
    `Host capability ${capability} is unavailable outside a runtime host. ` +
      `Run this operation through Stoke CLI or another host that supports typed host capabilities.`,
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

function consoleLevelToLogStream(level: ConsoleLevel): WorkflowLogStream {
  switch (level) {
    case "debug": return "debug";
    case "warn":  return "warn";
    case "error": return "stderr";
    case "info":
    case "log":
    default:      return "info";
  }
}
