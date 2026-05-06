import type {
  DependencyContext,
  DevMachineDefinition,
  DevProviderDefinition,
  EnvResolver,
  ProviderWorkspaceContext,
  StepDefinition,
  StepDefinitionOptions,
  StepHandler,
  StepHandlerResult,
  StepReturnContext,
  StepInstance,
} from "./types.ts";

export const env: EnvResolver = (name, fallback) => {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
};

export function defineStep<
  const Dependencies extends readonly StepInstance<any, any>[],
  Result extends StepHandlerResult,
>(
  name: string,
  options: StepDefinitionOptions<Dependencies>,
  handler: StepHandler<void, DependencyContext<Dependencies>, Result>,
): StepDefinition<void, StepReturnContext<Result>>;
export function defineStep<Result extends StepHandlerResult>(
  name: string,
  handler: StepHandler<void, {}, Result>,
): StepDefinition<void, StepReturnContext<Result>>;
export function defineStep<Input, Result extends StepHandlerResult>(
  name: string,
  handler: StepHandler<Input, {}, Result>,
): StepDefinition<Input, StepReturnContext<Result>>;
export function defineStep<Input = void>(
  name: string,
  optionsOrHandler: StepDefinitionOptions | StepHandler<Input, any, StepHandlerResult>,
  maybeHandler?: StepHandler<Input, any, StepHandlerResult>,
): StepDefinition<Input, any> {
  const options = typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
  const handler = (typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler) as StepHandler<Input, any, StepHandlerResult>;
  if (!handler) throw new Error(`Step ${name} is missing a handler`);

  const dependsOn = options.dependsOn ?? [];
  const create = ((input?: Input) =>
    createStepInstance({
      name,
      input: input as Input,
      dependsOn,
      handler,
    })) as StepDefinition<Input, any>;

  Object.defineProperties(create, {
    kind: { value: "fdev.step", enumerable: true },
    name: { value: name, enumerable: true },
    input: { value: undefined as Input, enumerable: true },
    dependsOn: { value: dependsOn, enumerable: true },
    handler: { value: handler, enumerable: true },
  });

  return create;
}

export function defineDevMachine<
  Options = undefined,
  Provider extends DevProviderDefinition = DevProviderDefinition,
  const Steps extends readonly StepInstance<any, any>[] = readonly StepInstance<any, any>[],
>(
  definition: Omit<DevMachineDefinition<Options, Provider, Steps>, "kind">,
): DevMachineDefinition<Options, Provider, Steps> {
  if (Array.isArray(definition.steps)) {
    validateStepDependencies(definition.name, definition.steps);
  }

  const machine = {
    kind: "fdev.machine" as const,
    ...definition,
  };

  return machine;
}

export function defineProvider<
  const ProviderId extends string,
  const Config extends object,
  WorkspaceContext extends ProviderWorkspaceContext = ProviderWorkspaceContext,
>(
  providerId: ProviderId,
  config: DevProviderDefinition<ProviderId, Config, WorkspaceContext>["config"],
  plugin?: unknown,
): DevProviderDefinition<ProviderId, Config, WorkspaceContext> {
  return {
    kind: "fdev.provider",
    providerId,
    config,
    plugin,
  };
}

export function isStep(value: unknown): value is StepInstance<any, any> {
  return Boolean(value && (typeof value === "object" || typeof value === "function") && getKind(value) === "fdev.step");
}

export function isDevMachine(value: unknown): value is DevMachineDefinition<any> {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.machine");
}

export function isProviderDefinition(value: unknown): value is DevProviderDefinition {
  return Boolean(value && typeof value === "object" && getKind(value) === "fdev.provider");
}

export function validateStepDependencies(machineName: string, steps: readonly StepInstance<any, any>[]): void {
  const seen = new Map<string, StepInstance<any, any>>();

  for (const step of steps) {
    if (!isStep(step)) {
      throw new Error(`Machine ${machineName} includes an invalid step`);
    }

    const key = stepKey(step);
    if (seen.has(key)) {
      throw new Error(`Machine ${machineName} includes duplicate step ${step.name}`);
    }

    for (const dependency of step.dependsOn) {
      if (!isStep(dependency)) {
        throw new Error(`Step ${step.name} includes an invalid dependency`);
      }

      if (!seen.has(stepKey(dependency))) {
        throw new Error(`Step ${step.name} depends on ${dependency.name}, but it is not listed before it`);
      }
    }

    seen.set(key, step);
  }
}

function createStepInstance<Input>(input: {
  name: string;
  input: Input;
  dependsOn: readonly StepInstance<any, any>[];
  handler: StepHandler<Input, any, any>;
}): StepInstance<Input, any> {
  return {
    kind: "fdev.step",
    name: input.name,
    input: input.input,
    dependsOn: input.dependsOn,
    handler: input.handler,
  };
}

function stepKey(step: StepInstance<any, any>): string {
  return `${step.name}\0${JSON.stringify(step.input ?? null)}`;
}

function getKind(value: object | Function): unknown {
  return (value as { kind?: unknown }).kind;
}
