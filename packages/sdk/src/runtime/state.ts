import {
  StateStore,
  emptyStateSnapshot,
  type StateService,
  type StateServiceFactory,
  type StateSnapshot,
} from "@usestoke/engine";

export type RuntimeStateSnapshot = {
  version: 1;
  scopes: Record<string, StateSnapshot>;
};

export type RuntimeStateCoordinator = {
  readonly project: StateService;
  readonly stateFactory: StateServiceFactory;
  exportSnapshot(): RuntimeStateSnapshot;
  persist(): Promise<void>;
};

export function emptyRuntimeStateSnapshot(): RuntimeStateSnapshot {
  return { version: 1, scopes: {} };
}

export function createRuntimeStateCoordinator(options: {
  snapshot?: RuntimeStateSnapshot;
  persist?: (snapshot: RuntimeStateSnapshot) => Promise<void>;
} = {}): RuntimeStateCoordinator {
  const initial = options.snapshot ?? emptyRuntimeStateSnapshot();
  const stores = new Map<string, StateStore>();
  const stateFor = (scope: string, projectDir: string): StateStore => {
    let state = stores.get(scope);
    if (!state) {
      state = new StateStore({
        projectDir,
        scope,
        snapshot: initial.scopes[scope] ?? emptyStateSnapshot(),
      });
      stores.set(scope, state);
    }
    return state;
  };
  const stateFactory: StateServiceFactory = (input) => stateFor(input.scope ?? "project", input.projectDir);
  for (const scope of Object.keys(initial.scopes)) stateFor(scope, ".");
  const project = stateFor("project", ".");

  return {
    project,
    stateFactory,
    exportSnapshot() {
      return {
        version: 1,
        scopes: Object.fromEntries(
          [...stores.entries()].map(([scope, state]) => [scope, state.exportSnapshot()]),
        ),
      };
    },
    async persist() {
      await options.persist?.(this.exportSnapshot());
    },
  };
}
