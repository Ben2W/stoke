import {
  createStateStore,
  type StateService,
  type StateServiceOptions,
} from "@freestyle-sh/fdev-engine";

export type RuntimeStateService = StateService;
export type RuntimeStateServiceOptions = StateServiceOptions;

export function createRuntimeStateService(options: RuntimeStateServiceOptions): RuntimeStateService {
  return createStateStore(options);
}
