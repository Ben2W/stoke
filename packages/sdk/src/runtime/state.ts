import {
  createStateStore,
  type StateService,
  type StateServiceOptions,
} from "@rigkit/engine";

export type RuntimeStateService = StateService;
export type RuntimeStateServiceOptions = StateServiceOptions;

export function createRuntimeStateService(options: RuntimeStateServiceOptions): RuntimeStateService {
  return createStateStore(options);
}
