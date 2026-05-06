import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDevMachine, isProviderDefinition, isStep, validateStepDependencies } from "@freestyle-sh/fdev-sdk";
import { loadDotEnv } from "./env-file.ts";
import { hash } from "./hash.ts";
import type { BaseDevMachineProvider, BaseProviderPlugin, ProviderFactory, VmHandle } from "./provider/types.ts";
import { StateStore, type SnapshotRecord } from "./state.ts";
import type {
  DevMachineDefinition,
  DevMachineEvent,
  EventHandler,
  ExecOptions,
  JsonValue,
  LoadedProviderDefinition,
  LoadedMachine,
  MachinePlan,
  StepCommandOptions,
  StepInstance,
  StepRuntimeContext,
  WorkspaceRecord,
} from "@freestyle-sh/fdev-sdk";

export type CreateDevMachineEngineOptions = {
  projectDir?: string;
  configPath?: string;
  providers?: BaseProviderPlugin[];
  providerFactory?: ProviderFactory;
};

export type EngineLoadResult = {
  machine: LoadedMachine;
  machines: LoadedMachine[];
  projectDir: string;
  configPath: string;
  statePath: string;
};

export type EngineProjectInfo = {
  projectDir: string;
  configPath: string;
  statePath: string;
  machine?: MachineSummary;
};

export type MachineSummary = {
  name: string;
  providerId: string;
  steps: string[];
  workspace?: LoadedMachine["workspace"];
};

export class DevMachineEngine {
  private readonly projectDir: string;
  private readonly configPath: string;
  private readonly statePath: string;
  private state: StateStore | undefined;
  private providers: BaseProviderPlugin[];
  private readonly providerFactory: ProviderFactory;
  private readonly handlers = new Set<EventHandler>();
  private machines = new Map<string, LoadedMachine>();

  constructor(options: CreateDevMachineEngineOptions = {}) {
    this.configPath = options.configPath
      ? resolve(options.configPath)
      : join(resolve(options.projectDir ?? process.cwd()), "fdev.config.ts");
    this.projectDir = resolve(options.configPath ? dirname(this.configPath) : options.projectDir ?? process.cwd());
    this.statePath = join(this.projectDir, ".fdev", "state.sqlite");
    this.providers = options.providers ?? [];
    this.providerFactory = options.providerFactory ?? ((input) => this.createProviderFromPlugin(input));
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async load(): Promise<EngineLoadResult> {
    loadDotEnv(this.projectDir);

    if (!existsSync(this.configPath)) {
      throw new Error(
        `No fdev config found at ${this.configPath}. Create one with "fdev init" or pass --config <file>.`,
      );
    }

    const moduleUrl = pathToFileURL(this.configPath);
    moduleUrl.searchParams.set("t", String(Date.now()));
    const mod = await import(moduleUrl.href);
    const definition = normalizeDefinition(mod.default ?? mod.machine);
    const machine = await this.resolveMachine(definition);
    const loaded = [machine];
    this.providers = mergeProviderPlugins([
      ...this.providers,
      ...loaded.map((machine) => machine.provider.plugin).filter(isBaseProviderPlugin),
    ]);
    this.state = new StateStore(this.projectDir, {
      providerSchemas: this.providers.map((provider) => provider.schema).filter(isDefined),
    });
    await this.state.syncSchema();

    this.machines = new Map(loaded.map((machine) => [machine.name, machine]));

    for (const machine of loaded) {
      this.emit({ type: "definition.loaded", machine: machine.name });
    }

    return {
      machine,
      machines: loaded,
      projectDir: this.projectDir,
      configPath: this.configPath,
      statePath: this.getState().path,
    };
  }

  listMachines(): LoadedMachine[] {
    return [...this.machines.values()];
  }

  getProjectInfo(): EngineProjectInfo {
    return {
      projectDir: this.projectDir,
      configPath: this.configPath,
      statePath: this.state?.path ?? this.statePath,
      machine: this.machines.size === 1 ? summarizeMachine([...this.machines.values()][0]!) : undefined,
    };
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.getState().listWorkspaces();
  }

  listSnapshots(): SnapshotRecord[] {
    return this.getState().listSnapshots();
  }

  async plan(input: { machine?: string } = {}): Promise<MachinePlan> {
    const machine = this.getMachine(input.machine);
    const chain = this.buildChain(machine);
    const cached = this.findCachedPrefix(machine, chain.keys);
    const steps = machine.steps.map((step, index) => ({
      index,
      name: step.name,
      input: step.input,
      key: chain.keys[index]!,
      status: index < cached.prefixLength ? "cached" as const : "pending" as const,
    }));

    const plan: MachinePlan = {
      machine: machine.name,
      machineKey: chain.machineKey,
      cachedPrefixLength: cached.prefixLength,
      cachedSnapshotId: cached.snapshot?.snapshotId,
      steps,
    };

    this.emit({
      type: "plan.created",
      machine: machine.name,
      cachedPrefixLength: cached.prefixLength,
      stepCount: steps.length,
    });

    return plan;
  }

  async apply(input: { machine?: string } = {}): Promise<{ snapshotId?: string; vmId?: string; plan: MachinePlan }> {
    const machine = this.getMachine(input.machine);
    const provider = await this.createProvider(machine);
    const chain = this.buildChain(machine);
    const cached = this.findCachedPrefix(machine, chain.keys);
    let context: Record<string, JsonValue> = { ...(cached.snapshot?.context ?? {}) };
    let metadata: Record<string, JsonValue> = {};
    let vm: VmHandle | undefined;

    if (cached.prefixLength >= machine.steps.length) {
      const plan = await this.plan({ machine: machine.name });
      if (cached.snapshot) {
        this.emit({ type: "step.skipped", step: "all", snapshotId: cached.snapshot.snapshotId });
      }
      return {
        snapshotId: cached.snapshot?.snapshotId,
        plan,
      };
    }

    vm = await this.createVmForApply(provider, cached.snapshot);

    for (let index = cached.prefixLength; index < machine.steps.length; index += 1) {
      const step = machine.steps[index]!;
      this.emit({ type: "step.started", step: step.name });

      metadata = {};
      const runtime = this.createRuntimeContext({
        machine,
        step,
        provider,
        vm,
        context,
        metadata,
      });

      const result = await step.handler(runtime as never);
      if (result && typeof result === "object" && result.ctx) {
        Object.assign(context, result.ctx);
      }

      const snapshot = await provider.snapshot(vm);
      const record: SnapshotRecord = {
        id: crypto.randomUUID(),
        providerId: provider.providerId,
        machine: machine.name,
        machineKey: chain.machineKey,
        prefixKeys: chain.keys.slice(0, index + 1),
        prefixLength: index + 1,
        snapshotId: snapshot.snapshotId,
        sourceVmId: snapshot.sourceVmId,
        createdAt: new Date().toISOString(),
        stepName: step.name,
        context: { ...context },
        metadata: { ...metadata },
      };

      this.getState().replaceStepSnapshot(record);

      this.emit({ type: "snapshot.created", step: step.name, snapshotId: snapshot.snapshotId });
    }

    const plan = await this.plan({ machine: machine.name });
    return {
      vmId: vm?.vmId,
      snapshotId: plan.cachedSnapshotId,
      plan,
    };
  }

  async fork(input: { machine?: string; name: string }): Promise<WorkspaceRecord> {
    if (!input.name) throw new Error(`fork requires a workspace name`);

    const applied = await this.apply({ machine: input.machine });
    if (!applied.snapshotId) {
      throw new Error(`Cannot fork ${applied.plan.machine}: no resolved snapshot`);
    }

    const machine = this.getMachine(input.machine);
    const provider = await this.createProvider(machine);
    const vm = await provider.createVmFromSnapshot({
      snapshotId: applied.snapshotId,
    });

    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      providerId: provider.providerId,
      vmId: vm.vmId,
      machine: machine.name,
      snapshotId: applied.snapshotId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    this.getState().saveWorkspace(workspace);

    this.emit({
      type: "workspace.ready",
      workspaceId: input.name,
      vmId: vm.vmId,
      snapshotId: applied.snapshotId,
    });

    return workspace;
  }

  async attachTerminal(input: {
    workspaceOrVmId: string;
    machine?: string;
    printOnly?: boolean;
    user?: string;
  }): Promise<{ command: string }> {
    const workspace = this.getState().findWorkspace(input.workspaceOrVmId);
    const vmId = workspace?.vmId ?? input.workspaceOrVmId;
    const machine = this.getMachine(input.machine ?? workspace?.machine);
    const provider = await this.createProvider(machine);
    const terminal = await provider.ssh({ vmId }, { user: input.user });

    if (!input.printOnly) {
      const proc = Bun.spawn(["sh", "-lc", terminal.command], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    }

    return terminal;
  }

  async deleteWorkspace(input: { workspace: string; machine?: string }): Promise<WorkspaceRecord> {
    const workspace = this.getState().getWorkspace(input.workspace);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);

    const machine = this.getMachine(input.machine ?? workspace.machine);
    const provider = await this.createProvider(machine);
    await provider.deleteVm({ vmId: workspace.vmId });

    this.getState().deleteWorkspace(input.workspace);

    return workspace;
  }

  async snapshotWorkspace(input: { workspace: string; label?: string; machine?: string }): Promise<SnapshotRecord> {
    const workspace = this.getState().getWorkspace(input.workspace);
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);

    const machine = this.getMachine(input.machine ?? workspace.machine);
    const provider = await this.createProvider(machine);
    const snapshot = await provider.snapshot({ vmId: workspace.vmId });
    const chain = this.buildChain(machine);
    const cached = this.findCachedPrefix(machine, chain.keys);

    const record: SnapshotRecord = {
      id: crypto.randomUUID(),
      providerId: provider.providerId,
      machine: machine.name,
      machineKey: chain.machineKey,
      prefixKeys: chain.keys,
      prefixLength: chain.keys.length,
      snapshotId: snapshot.snapshotId,
      sourceVmId: snapshot.sourceVmId,
      createdAt: new Date().toISOString(),
      stepName: input.label ?? `workspace:${workspace.name}`,
      context: { ...(cached.snapshot?.context ?? {}) },
      metadata: { workspace: workspace.name, label: input.label ?? null },
    };

    this.getState().addSnapshot(record);

    return record;
  }

  private async createVmForApply(
    provider: BaseDevMachineProvider,
    snapshot: SnapshotRecord | undefined,
  ): Promise<VmHandle> {
    const vm = snapshot
      ? await provider.createVmFromSnapshot({
          snapshotId: snapshot.snapshotId,
        })
      : await provider.createVm();

    this.emit({ type: "vm.created", vmId: vm.vmId, fromSnapshotId: snapshot?.snapshotId });
    return vm;
  }

  private createRuntimeContext(input: {
    machine: LoadedMachine;
    step: StepInstance<any, any>;
    provider: BaseDevMachineProvider;
    vm: VmHandle;
    context: Record<string, JsonValue>;
    metadata: Record<string, JsonValue>;
  }): StepRuntimeContext<any, any> {
    const { step, provider, vm, context, metadata } = input;
    const runCommand = async (command: string, options?: StepCommandOptions) => {
      const commandName = options?.name ?? command;
      const { name: _name, ...execOptions } = options ?? {};
      this.emit({ type: "command.started", step: step.name, commandName, command });
      const result = await provider.exec(vm, command, execOptions);
      if (result.stdout) {
        this.emit({ type: "command.output", step: step.name, commandName, stream: "stdout", data: result.stdout });
      }
      if (result.stderr) {
        this.emit({ type: "command.output", step: step.name, commandName, stream: "stderr", data: result.stderr });
      }
      this.emit({ type: "command.completed", step: step.name, commandName, exitCode: result.exitCode });
      return { commandName, result };
    };

    const vmInspector = {
      vmId: vm.vmId,
      exec: async (command: string, options?: StepCommandOptions) => {
        const { commandName, result } = await runCommand(command, options);
        if (!result.ok) {
          throw new Error(commandFailureMessage(commandName, result));
        }
        return result;
      },
      probe: async (command: string, options?: StepCommandOptions) => {
        const { result } = await runCommand(command, options);
        return result;
      },
      exists: async (path: string) => {
        const result = await provider.exec(vm, `test -e ${shellPath(path)}`);
        return result.ok;
      },
      readFile: (path: string) => provider.readFile(vm, path),
      writeFile: (path: string, content: string) => provider.writeFile(vm, path, content),
    };

    const runtime = {
      input: step.input,
      vm: vmInspector,
      interact: {
        terminal: async (name: string, options?: { command?: string; instructions?: string }) => {
          this.emit({
            type: "interaction.awaiting_user",
            step: step.name,
            label: name,
            command: options?.command,
            instructions: options?.instructions,
          });

          const terminal = await provider.ssh(vm);
          const command = options?.command
            ? `${terminal.command} -t ${shellQuote(options.command)}`
            : terminal.command;

          console.error(`\nInteractive step: ${name}`);
          if (options?.instructions) console.error(options.instructions);
          console.error(command);
          console.error("Press Enter after completing the interactive work.");
          await readLine();

          this.emit({ type: "interaction.completed", step: step.name, label: name });
        },
      },
      snapshot: {
        before: async (name: string, command: string, options?: ExecOptions) => {
          await runtime.vm.exec(command, { ...options, name });
        },
        metadata: (value: Record<string, JsonValue>) => {
          Object.assign(metadata, value);
        },
      },
      ctx: {
        get: <T = unknown>(key: string) => context[key] as T | undefined,
        require: <T = unknown>(key: string) => {
          if (!(key in context)) throw new Error(`Missing required context value ${key}`);
          return context[key] as T;
        },
        set: (key: string, value: JsonValue) => {
          context[key] = value;
        },
      },
    } satisfies StepRuntimeContext<any, any>;

    return runtime;
  }

  private getMachine(name: string | undefined): LoadedMachine {
    if (this.machines.size === 0) {
      throw new Error(`No machines loaded. Call engine.load() first.`);
    }

    if (name) {
      const machine = this.machines.get(name);
      if (!machine) throw new Error(`Unknown dev machine ${name}`);
      return machine;
    }

    if (this.machines.size === 1) return [...this.machines.values()][0]!;

    throw new Error(`Multiple dev machines are defined; pass a machine name`);
  }

  private getState(): StateStore {
    if (!this.state) {
      throw new Error(`No state database loaded. Call engine.load() first.`);
    }
    return this.state;
  }

  private async createProvider(machine: LoadedMachine): Promise<BaseDevMachineProvider> {
    return await this.providerFactory({
      provider: machine.provider,
      db: this.getState().db,
    });
  }

  private async createProviderFromPlugin(input: Parameters<ProviderFactory>[0]): Promise<BaseDevMachineProvider> {
    const plugin = this.providers.find((provider) => provider.providerId === input.provider.providerId);
    if (!plugin) {
      throw new Error(
        `Provider ${input.provider.providerId} does not implement the base fdev provider contract. ` +
          `Register a provider plugin to use it with defineStep, fdev ssh, or the generic terminal interface.`,
      );
    }
    return await plugin.createProvider(input);
  }

  private async resolveMachine(definition: DevMachineDefinition<any>): Promise<LoadedMachine> {
    if (!isProviderDefinition(definition.provider)) {
      throw new Error(`Machine ${definition.name} must define a provider`);
    }

    const provider = await resolveProviderDefinition(definition.provider);
    const steps =
      typeof definition.steps === "function"
        ? definition.steps({ options: definition.options })
        : definition.steps;

    for (const step of steps) {
      if (!isStep(step)) {
        throw new Error(`Machine ${definition.name} includes an invalid step`);
      }
    }
    validateStepDependencies(definition.name, steps);

    return {
      name: definition.name,
      provider,
      options: definition.options,
      steps,
      workspace: definition.workspace,
    };
  }

  private buildChain(machine: LoadedMachine): { machineKey: string; keys: string[] } {
    const machineKey = hash({
      name: machine.name,
      providerId: machine.provider.providerId,
      providerConfig: machine.provider.config,
    });
    const keys = machine.steps.map((step) =>
      hash({
        name: step.name,
        input: step.input ?? null,
      }),
    );
    return { machineKey, keys };
  }

  private findCachedPrefix(
    machine: LoadedMachine,
    keys: string[],
  ): { prefixLength: number; snapshot?: SnapshotRecord } {
    const machineKey = this.buildChain(machine).machineKey;
    const snapshots = this.state
      ?.listSnapshots()
      ?? [];
    const matching = snapshots
      .filter((snapshot) =>
        snapshot.providerId === machine.provider.providerId &&
        snapshot.machine === machine.name &&
        snapshot.machineKey === machineKey
      )
      .filter((snapshot) => isPrefix(snapshot.prefixKeys, keys))
      .sort((a, b) => b.prefixLength - a.prefixLength || b.createdAt.localeCompare(a.createdAt));

    const snapshot = matching[0];
    return {
      prefixLength: snapshot?.prefixLength ?? 0,
      snapshot,
    };
  }

  private emit(event: DevMachineEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}

export async function createDevMachineEngine(
  options: CreateDevMachineEngineOptions = {},
): Promise<DevMachineEngine> {
  return new DevMachineEngine(options);
}

async function resolveProviderDefinition(
  definition: DevMachineDefinition<any>["provider"],
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

function normalizeDefinition(value: unknown): DevMachineDefinition<any> {
  if (Array.isArray(value)) {
    throw new Error(`fdev.config.ts must default export exactly one dev machine`);
  }
  if (!isDevMachine(value)) {
    throw new Error(`fdev.config.ts must default export defineDevMachine({ ... })`);
  }
  return value;
}

function summarizeMachine(machine: LoadedMachine): MachineSummary {
  return {
    name: machine.name,
    providerId: machine.provider.providerId,
    steps: machine.steps.map((step) => step.name),
    workspace: machine.workspace,
  };
}

function isPrefix(prefix: string[], full: string[]): boolean {
  if (prefix.length > full.length) return false;
  return prefix.every((key, index) => key === full[index]);
}

function shellPath(path: string): string {
  if (path.startsWith("~/")) return `~/${shellQuote(path.slice(2))}`;
  return shellQuote(path);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

function commandFailureMessage(name: string, result: { exitCode: number; stdout: string; stderr: string }): string {
  const output = [
    result.stdout ? `stdout:\n${result.stdout.trimEnd()}` : "",
    result.stderr ? `stderr:\n${result.stderr.trimEnd()}` : "",
  ].filter(Boolean).join("\n");
  return `Command "${name}" failed with exit code ${result.exitCode}${output ? `\n${output}` : ""}`;
}

async function readLine(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}
