import type { ProviderStorage, ProviderStorageRecord } from "./provider/types.ts";
import type { JsonValue, WorkspaceRecord } from "./types.ts";
import { stableJson } from "./hash.ts";

export type WorkflowNodeRunRecord = {
  id: string;
  workflow: string;
  nodePath: string;
  nodeName: string;
  nodeKind: string;
  nodeKey: string;
  providerFingerprint: string;
  upstreamRunIds: string[];
  output: Record<string, JsonValue>;
  artifacts: JsonValue[];
  invalidated: boolean;
  createdAt: string;
  metadata: Record<string, JsonValue>;
};

export type SnapshotRecord = WorkflowNodeRunRecord;

export type WorkflowApplyRecord = {
  workflow: string;
  providerFingerprint: string;
  cachedNodeCount: number;
  nodeCount: number;
  appliedAt: string;
};

export type StateSnapshot = {
  workspaces: WorkspaceRecord[];
  workflowApplies: WorkflowApplyRecord[];
  nodeRuns: WorkflowNodeRunRecord[];
  providerState: ProviderStorageRecord[];
};

export type StateServiceOptions = {
  projectDir: string;
  scope?: string;
  snapshot?: StateSnapshot;
  projectId?: string;
  configPath?: string;
  runtimeVersion?: string;
  source?: JsonValue;
};

export type StateServiceFactory = (options: StateServiceOptions) => StateService;

export interface StateService {
  readonly id: string;
  exportSnapshot(): StateSnapshot;
  listWorkspaces(): WorkspaceRecord[];
  listWorkspacesByName(name: string): WorkspaceRecord[];
  findWorkspace(nameOrResourceId: string, workflow?: string): WorkspaceRecord | undefined;
  getWorkspace(name: string, workflow?: string): WorkspaceRecord | undefined;
  saveWorkspace(workspace: WorkspaceRecord): void;
  deleteWorkspace(name: string, workflow: string): void;
  listWorkflowApplies(): WorkflowApplyRecord[];
  getWorkflowApply(workflow: string): WorkflowApplyRecord | undefined;
  saveWorkflowApply(record: WorkflowApplyRecord): void;
  listNodeRuns(): WorkflowNodeRunRecord[];
  listSnapshots(): SnapshotRecord[];
  findReusableNodeRun(input: {
    workflow: string;
    nodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
  }): WorkflowNodeRunRecord | undefined;
  saveNodeRun(run: WorkflowNodeRunRecord): void;
  clearNodeRuns(input?: {
    workflow?: string;
    nodePaths?: readonly string[];
  }): number;
  deleteNodeRunsById(ids: readonly string[]): number;
  invalidateNodeRuns(input: {
    workflow: string;
    nodePaths: readonly string[];
  }): string[];
  providerStorage(providerId: string): ProviderStorage;
}

export class StateStore implements StateService {
  readonly id: string;
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly workflowApplies = new Map<string, WorkflowApplyRecord>();
  private readonly nodeRuns = new Map<string, WorkflowNodeRunRecord>();
  private readonly providerRecords = new Map<string, ProviderStorageRecord>();

  constructor(options: StateServiceOptions) {
    this.id = options.scope ?? "project";
    this.importSnapshot(options.snapshot ?? emptyStateSnapshot());
  }

  exportSnapshot(): StateSnapshot {
    return {
      workspaces: this.listWorkspaces(),
      workflowApplies: this.listWorkflowApplies(),
      nodeRuns: this.listNodeRuns(),
      providerState: [...this.providerRecords.values()]
        .sort((left, right) => providerRecordKey(left.providerId, left.key).localeCompare(providerRecordKey(right.providerId, right.key)))
        .map(cloneProviderStorageRecord),
    };
  }

  listWorkspaces(): WorkspaceRecord[] {
    return [...this.workspaces.values()]
      .sort((left, right) => left.workflow.localeCompare(right.workflow) || left.name.localeCompare(right.name))
      .map(cloneWorkspace);
  }

  listWorkspacesByName(name: string): WorkspaceRecord[] {
    return this.listWorkspaces().filter((workspace) => workspace.name === name);
  }

  findWorkspace(nameOrResourceId: string, workflow?: string): WorkspaceRecord | undefined {
    const matches = this.listWorkspaces().filter((workspace) =>
      (workspace.name === nameOrResourceId || workspace.id === nameOrResourceId)
      && (workflow === undefined || workspace.workflow === workflow)
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  getWorkspace(name: string, workflow?: string): WorkspaceRecord | undefined {
    if (workflow !== undefined) {
      const workspace = this.workspaces.get(workspaceKey(workflow, name));
      return workspace ? cloneWorkspace(workspace) : undefined;
    }
    const matches = this.listWorkspacesByName(name);
    return matches.length === 1 ? matches[0] : undefined;
  }

  saveWorkspace(workspace: WorkspaceRecord): void {
    this.workspaces.set(workspaceKey(workspace.workflow, workspace.name), cloneWorkspace(workspace));
  }

  deleteWorkspace(name: string, workflow: string): void {
    this.workspaces.delete(workspaceKey(workflow, name));
  }

  listWorkflowApplies(): WorkflowApplyRecord[] {
    return [...this.workflowApplies.values()]
      .sort((left, right) => left.workflow.localeCompare(right.workflow))
      .map((record) => ({ ...record }));
  }

  getWorkflowApply(workflow: string): WorkflowApplyRecord | undefined {
    const record = this.workflowApplies.get(workflow);
    return record ? { ...record } : undefined;
  }

  saveWorkflowApply(record: WorkflowApplyRecord): void {
    this.workflowApplies.set(record.workflow, { ...record });
  }

  listNodeRuns(): WorkflowNodeRunRecord[] {
    return [...this.nodeRuns.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneNodeRun);
  }

  listSnapshots(): SnapshotRecord[] {
    return this.listNodeRuns();
  }

  findReusableNodeRun(input: {
    workflow: string;
    nodePath: string;
    nodeKey: string;
    providerFingerprint: string;
    upstreamRunIds: readonly string[];
  }): WorkflowNodeRunRecord | undefined {
    const upstream = stableJson([...input.upstreamRunIds]);
    return this.listNodeRuns().find((run) =>
      !run.invalidated
      && run.workflow === input.workflow
      && run.nodePath === input.nodePath
      && run.nodeKey === input.nodeKey
      && run.providerFingerprint === input.providerFingerprint
      && stableJson(run.upstreamRunIds) === upstream
    );
  }

  saveNodeRun(run: WorkflowNodeRunRecord): void {
    this.nodeRuns.set(run.id, cloneNodeRun(run));
  }

  clearNodeRuns(input: { workflow?: string; nodePaths?: readonly string[] } = {}): number {
    const nodePaths = input.nodePaths ? new Set(input.nodePaths) : undefined;
    const ids = [...this.nodeRuns.values()]
      .filter((run) =>
        (input.workflow === undefined || run.workflow === input.workflow)
        && (nodePaths === undefined || nodePaths.has(run.nodePath))
      )
      .map((run) => run.id);
    return this.deleteNodeRunsById(ids);
  }

  deleteNodeRunsById(ids: readonly string[]): number {
    let deleted = 0;
    for (const id of ids) if (this.nodeRuns.delete(id)) deleted += 1;
    return deleted;
  }

  invalidateNodeRuns(input: { workflow: string; nodePaths: readonly string[] }): string[] {
    const targetPaths = new Set(input.nodePaths);
    if (targetPaths.size === 0) return [];
    const rows = this.listNodeRuns()
      .filter((run) => run.workflow === input.workflow)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const invalidatedIds = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (row.invalidated || invalidatedIds.has(row.id)) continue;
        if (!targetPaths.has(row.nodePath) && !row.upstreamRunIds.some((id) => invalidatedIds.has(id))) continue;
        invalidatedIds.add(row.id);
        changed = true;
      }
    }
    for (const id of invalidatedIds) {
      const row = this.nodeRuns.get(id);
      if (row) this.nodeRuns.set(id, { ...row, invalidated: true });
    }
    return [...invalidatedIds];
  }

  providerStorage(providerId: string): ProviderStorage {
    return new MemoryProviderStorage(this.providerRecords, providerId);
  }

  private importSnapshot(snapshot: StateSnapshot): void {
    for (const workspace of snapshot.workspaces) this.saveWorkspace(workspace);
    for (const record of snapshot.workflowApplies) this.saveWorkflowApply(record);
    for (const run of snapshot.nodeRuns) this.saveNodeRun(run);
    for (const record of snapshot.providerState) {
      this.providerRecords.set(providerRecordKey(record.providerId, record.key), cloneProviderStorageRecord(record));
    }
  }
}

export const createStateStore: StateServiceFactory = (options) => new StateStore(options);

export function emptyStateSnapshot(): StateSnapshot {
  return { workspaces: [], workflowApplies: [], nodeRuns: [], providerState: [] };
}

class MemoryProviderStorage implements ProviderStorage {
  constructor(
    private readonly records: Map<string, ProviderStorageRecord>,
    private readonly providerId: string,
  ) {}

  get<Value extends JsonValue = JsonValue>(key: string): ProviderStorageRecord<Value> | undefined {
    const record = this.records.get(providerRecordKey(this.providerId, key));
    return record ? cloneProviderStorageRecord(record) as ProviderStorageRecord<Value> : undefined;
  }

  set<Value extends JsonValue = JsonValue>(key: string, value: Value): ProviderStorageRecord<Value> {
    const now = new Date().toISOString();
    const existing = this.get(key);
    const record: ProviderStorageRecord<Value> = {
      providerId: this.providerId,
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(providerRecordKey(this.providerId, key), cloneProviderStorageRecord(record));
    return cloneProviderStorageRecord(record) as ProviderStorageRecord<Value>;
  }

  delete(key: string): void {
    this.records.delete(providerRecordKey(this.providerId, key));
  }

  entries(prefix = ""): ProviderStorageRecord[] {
    return [...this.records.values()]
      .filter((record) => record.providerId === this.providerId && record.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(cloneProviderStorageRecord);
  }
}

function workspaceKey(workflow: string, name: string): string {
  return `${workflow}\0${name}`;
}

function providerRecordKey(providerId: string, key: string): string {
  return `${providerId}\0${key}`;
}

function cloneWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
  return structuredClone(workspace);
}

function cloneNodeRun(run: WorkflowNodeRunRecord): WorkflowNodeRunRecord {
  return structuredClone(run);
}

function cloneProviderStorageRecord(record: ProviderStorageRecord): ProviderStorageRecord {
  return structuredClone(record);
}
