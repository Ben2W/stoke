import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDevMachine, isMigration } from "./authoring.ts";
import { loadDotEnv } from "./env-file.ts";
import { hash, stableJson } from "./hash.ts";
import { createFreestyleProvider } from "./provider/freestyle.ts";
import type { DevMachineProvider, VmHandle } from "./provider/types.ts";
import { StateStore, type SnapshotRecord } from "./state.ts";
import type {
  DevMachineDefinition,
  DevMachineEvent,
  EventHandler,
  ExecOptions,
  JsonValue,
  LoadedMachine,
  MachinePlan,
  MigrationInstance,
  MigrationRuntimeContext,
  WorkspaceRecord,
} from "./types.ts";

export type CreateDevMachineEngineOptions = {
  projectDir?: string;
  providerFactory?: (apiKey: string) => DevMachineProvider;
};

export type EngineLoadResult = {
  machines: LoadedMachine[];
};

export class DevMachineEngine {
  private readonly projectDir: string;
  private readonly state: StateStore;
  private readonly providerFactory: (apiKey: string) => DevMachineProvider;
  private readonly handlers = new Set<EventHandler>();
  private machines = new Map<string, LoadedMachine>();

  constructor(options: CreateDevMachineEngineOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd());
    this.state = new StateStore(this.projectDir);
    this.providerFactory = options.providerFactory ?? ((apiKey) => createFreestyleProvider({ apiKey }));
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async load(): Promise<EngineLoadResult> {
    loadDotEnv(this.projectDir);

    const configPath = await findConfig(this.projectDir);
    if (!configPath) {
      throw new Error(`No freestyle.dev.ts found in ${this.projectDir}`);
    }

    const moduleUrl = pathToFileURL(configPath);
    moduleUrl.searchParams.set("t", String(Date.now()));
    const mod = await import(moduleUrl.href);
    const definitions = normalizeDefinitions(mod.default ?? mod.machines);
    const loaded = await Promise.all(definitions.map((definition) => this.resolveMachine(definition)));

    this.machines = new Map(loaded.map((machine) => [machine.name, machine]));

    for (const machine of loaded) {
      this.emit({ type: "definition.loaded", machine: machine.name });
    }

    return { machines: loaded };
  }

  listMachines(): LoadedMachine[] {
    return [...this.machines.values()];
  }

  async plan(input: { machine?: string } = {}): Promise<MachinePlan> {
    const machine = this.getMachine(input.machine);
    const chain = this.buildChain(machine);
    const cached = this.findCachedPrefix(machine, chain.keys);
    const migrations = machine.migrations.map((migration, index) => ({
      index,
      name: migration.name,
      input: migration.input,
      key: chain.keys[index]!,
      status: index < cached.prefixLength ? "cached" as const : "pending" as const,
    }));

    const plan: MachinePlan = {
      machine: machine.name,
      machineKey: chain.machineKey,
      cachedPrefixLength: cached.prefixLength,
      cachedSnapshotId: cached.snapshot?.snapshotId,
      migrations,
    };

    this.emit({
      type: "plan.created",
      machine: machine.name,
      cachedPrefixLength: cached.prefixLength,
      migrationCount: migrations.length,
    });

    return plan;
  }

  async apply(input: { machine?: string } = {}): Promise<{ snapshotId?: string; vmId?: string; plan: MachinePlan }> {
    const machine = this.getMachine(input.machine);
    const provider = this.providerFactory(machine.apiKey);
    const chain = this.buildChain(machine);
    const cached = this.findCachedPrefix(machine, chain.keys);
    let context: Record<string, JsonValue> = { ...(cached.snapshot?.context ?? {}) };
    let metadata: Record<string, JsonValue> = {};
    let vm: VmHandle | undefined;

    if (cached.prefixLength >= machine.migrations.length) {
      const plan = await this.plan({ machine: machine.name });
      if (cached.snapshot) {
        this.emit({ type: "migration.skipped", migration: "all", snapshotId: cached.snapshot.snapshotId });
      }
      return {
        snapshotId: cached.snapshot?.snapshotId,
        plan,
      };
    }

    vm = await this.createVmForApply(provider, machine, cached.snapshot);

    for (let index = cached.prefixLength; index < machine.migrations.length; index += 1) {
      const migration = machine.migrations[index]!;
      this.emit({ type: "migration.started", migration: migration.name });

      metadata = {};
      const runtime = this.createRuntimeContext({
        machine,
        migration,
        provider,
        vm,
        context,
        metadata,
      });

      await migration.handler(runtime as never);

      const snapshot = await provider.snapshot(vm);
      const record: SnapshotRecord = {
        id: crypto.randomUUID(),
        machine: machine.name,
        machineKey: chain.machineKey,
        prefixKeys: chain.keys.slice(0, index + 1),
        prefixLength: index + 1,
        snapshotId: snapshot.snapshotId,
        sourceVmId: snapshot.sourceVmId,
        createdAt: new Date().toISOString(),
        migrationName: migration.name,
        context: { ...context },
        metadata: { ...metadata },
      };

      this.state.update((state) => {
        state.snapshots = state.snapshots.filter(
          (existing) =>
            !(
              existing.machine === record.machine &&
              existing.machineKey === record.machineKey &&
              existing.prefixLength === record.prefixLength &&
              stableJson(existing.prefixKeys) === stableJson(record.prefixKeys)
            ),
        );
        state.snapshots.push(record);
      });

      this.emit({ type: "snapshot.created", migration: migration.name, snapshotId: snapshot.snapshotId });
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
    const provider = this.providerFactory(machine.apiKey);
    const vm = await provider.createVmFromSnapshot({
      snapshotId: applied.snapshotId,
      idleTimeoutSeconds: machine.idleTimeoutSeconds,
    });

    const workspace: WorkspaceRecord = {
      name: input.name,
      vmId: vm.vmId,
      machine: machine.name,
      snapshotId: applied.snapshotId,
      createdAt: new Date().toISOString(),
    };

    this.state.update((state) => {
      state.workspaces[input.name] = workspace;
    });

    this.emit({
      type: "workspace.ready",
      workspaceId: input.name,
      vmId: vm.vmId,
      snapshotId: applied.snapshotId,
    });

    return workspace;
  }

  async attachTerminal(input: { workspaceOrVmId: string; machine?: string; printOnly?: boolean }): Promise<{ command: string }> {
    const state = this.state.read();
    const workspace = state.workspaces[input.workspaceOrVmId];
    const vmId = workspace?.vmId ?? input.workspaceOrVmId;
    const machine = this.getMachine(input.machine ?? workspace?.machine);
    const provider = this.providerFactory(machine.apiKey);
    const terminal = await provider.openTerminal({ vmId });

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

  async snapshotWorkspace(input: { workspace: string; label?: string; machine?: string }): Promise<SnapshotRecord> {
    const state = this.state.read();
    const workspace = state.workspaces[input.workspace];
    if (!workspace) throw new Error(`Unknown workspace ${input.workspace}`);

    const machine = this.getMachine(input.machine ?? workspace.machine);
    const provider = this.providerFactory(machine.apiKey);
    const snapshot = await provider.snapshot({ vmId: workspace.vmId });
    const chain = this.buildChain(machine);
    const cached = this.findCachedPrefix(machine, chain.keys);

    const record: SnapshotRecord = {
      id: crypto.randomUUID(),
      machine: machine.name,
      machineKey: chain.machineKey,
      prefixKeys: chain.keys,
      prefixLength: chain.keys.length,
      snapshotId: snapshot.snapshotId,
      sourceVmId: snapshot.sourceVmId,
      createdAt: new Date().toISOString(),
      migrationName: input.label ?? `workspace:${workspace.name}`,
      context: { ...(cached.snapshot?.context ?? {}) },
      metadata: { workspace: workspace.name, label: input.label ?? null },
    };

    this.state.update((next) => {
      next.snapshots.push(record);
    });

    return record;
  }

  private async createVmForApply(
    provider: DevMachineProvider,
    machine: LoadedMachine,
    snapshot: SnapshotRecord | undefined,
  ): Promise<VmHandle> {
    const vm = snapshot
      ? await provider.createVmFromSnapshot({
          snapshotId: snapshot.snapshotId,
          idleTimeoutSeconds: machine.idleTimeoutSeconds,
        })
      : await provider.createVm({
          image: machine.image,
          cpu: machine.cpu,
          memory: machine.memory,
          disk: machine.disk,
          idleTimeoutSeconds: machine.idleTimeoutSeconds,
        });

    this.emit({ type: "vm.created", vmId: vm.vmId, fromSnapshotId: snapshot?.snapshotId });
    return vm;
  }

  private createRuntimeContext(input: {
    machine: LoadedMachine;
    migration: MigrationInstance<any>;
    provider: DevMachineProvider;
    vm: VmHandle;
    context: Record<string, JsonValue>;
    metadata: Record<string, JsonValue>;
  }): MigrationRuntimeContext<any> {
    const { migration, provider, vm, context, metadata } = input;
    const vmInspector = {
      vmId: vm.vmId,
      exec: (command: string, options?: ExecOptions) => provider.exec(vm, command, options),
      exists: async (path: string) => {
        const result = await provider.exec(vm, `test -e ${shellPath(path)}`);
        return result.ok;
      },
      readFile: (path: string) => provider.readFile(vm, path),
      writeFile: (path: string, content: string) => provider.writeFile(vm, path, content),
    };

    const runtime = {
      input: migration.input,
      vm: vmInspector,
      step: {
        run: async (name: string, command: string, options?: ExecOptions) => {
          this.emit({ type: "step.started", migration: migration.name, step: name, command });
          const result = await provider.exec(vm, command, options);
          if (result.stdout) {
            this.emit({ type: "step.output", migration: migration.name, step: name, stream: "stdout", data: result.stdout });
          }
          if (result.stderr) {
            this.emit({ type: "step.output", migration: migration.name, step: name, stream: "stderr", data: result.stderr });
          }
          this.emit({ type: "step.completed", migration: migration.name, step: name, exitCode: result.exitCode });
          if (!result.ok) {
            throw new Error(`Step "${name}" failed with exit code ${result.exitCode}`);
          }
          return result;
        },
        assert: async (name: string, predicate: (context: MigrationRuntimeContext<any>) => unknown) => {
          this.emit({ type: "step.started", migration: migration.name, step: name });
          const passed = await predicate(runtime as MigrationRuntimeContext<any>);
          this.emit({ type: "step.completed", migration: migration.name, step: name, exitCode: passed ? 0 : 1 });
          if (!passed) throw new Error(`Assertion "${name}" failed`);
        },
      },
      interact: {
        terminal: async (name: string, options?: { command?: string; instructions?: string }) => {
          this.emit({
            type: "interaction.awaiting_user",
            migration: migration.name,
            label: name,
            command: options?.command,
            instructions: options?.instructions,
          });

          const terminal = await provider.openTerminal(vm);
          const command = options?.command
            ? `${terminal.command} -t ${shellQuote(options.command)}`
            : terminal.command;

          console.error(`\nInteractive step: ${name}`);
          if (options?.instructions) console.error(options.instructions);
          console.error(command);
          console.error("Press Enter after completing the interactive work.");
          await readLine();

          this.emit({ type: "interaction.completed", migration: migration.name, label: name });
        },
      },
      snapshot: {
        before: async (name: string, command: string, options?: ExecOptions) => {
          await runtime.step.run(name, command, options);
        },
        metadata: (value: Record<string, JsonValue>) => {
          Object.assign(metadata, value);
        },
      },
      get: <T = unknown>(key: string) => context[key] as T | undefined,
      require: <T = unknown>(key: string) => {
        if (!(key in context)) throw new Error(`Missing required context value ${key}`);
        return context[key] as T;
      },
      set: (key: string, value: JsonValue) => {
        context[key] = value;
      },
    } satisfies MigrationRuntimeContext<any>;

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

  private async resolveMachine(definition: DevMachineDefinition<any>): Promise<LoadedMachine> {
    const apiKey = typeof definition.apiKey === "function" ? await definition.apiKey() : definition.apiKey;
    const migrations =
      typeof definition.migrations === "function"
        ? definition.migrations({ options: definition.options })
        : definition.migrations;

    for (const migration of migrations) {
      if (!isMigration(migration)) {
        throw new Error(`Machine ${definition.name} includes an invalid migration`);
      }
    }

    return {
      name: definition.name,
      apiKey,
      image: definition.image,
      cpu: definition.cpu,
      memory: definition.memory,
      disk: definition.disk,
      idleTimeoutSeconds: definition.idleTimeoutSeconds,
      options: definition.options,
      migrations,
      workspace: definition.workspace,
    };
  }

  private buildChain(machine: LoadedMachine): { machineKey: string; keys: string[] } {
    const machineKey = hash({
      name: machine.name,
      image: machine.image,
      cpu: machine.cpu,
      memory: machine.memory,
      disk: machine.disk,
    });
    const keys = machine.migrations.map((migration) =>
      hash({
        name: migration.name,
        input: migration.input ?? null,
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
      .read()
      .snapshots.filter((snapshot) => snapshot.machine === machine.name && snapshot.machineKey === machineKey)
      .filter((snapshot) => isPrefix(snapshot.prefixKeys, keys))
      .sort((a, b) => b.prefixLength - a.prefixLength || b.createdAt.localeCompare(a.createdAt));

    const snapshot = snapshots[0];
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

async function findConfig(projectDir: string): Promise<string | undefined> {
  for (const name of ["freestyle.dev.ts", "freestyle.dev.mts", "freestyle.dev.js", "freestyle.dev.mjs"]) {
    const path = join(projectDir, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function normalizeDefinitions(value: unknown): DevMachineDefinition<any>[] {
  const values = Array.isArray(value) ? value : [value];
  const definitions = values.filter(isDevMachine);
  if (definitions.length === 0) {
    throw new Error(`freestyle.dev.ts must default export a dev machine or array of dev machines`);
  }
  return definitions;
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

async function readLine(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}
