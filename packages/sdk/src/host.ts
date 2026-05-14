export type HostCapabilityLogOptions = {
  stream?: "stdout" | "stderr" | "info";
  label?: string;
};

export type HostCapabilityContext = {
  log(data: string, options?: HostCapabilityLogOptions): void;
};

export type HostCapabilityDefinition<Input = unknown, Result = unknown> = {
  readonly schemaHash?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly handle: (params: Input, context?: HostCapabilityContext) => Result | Promise<Result>;
};

export type HostCapabilityHandler<Input = unknown, Result = unknown> =
  & HostCapabilityDefinition<Input, Result>
  & {
    readonly id: string;
  };

export function defineHostCapability<const Id extends string, Input = unknown, Result = unknown>(
  id: Id,
  definition: HostCapabilityDefinition<Input, Result>,
): HostCapabilityHandler<Input, Result> & { readonly id: Id } {
  return {
    id,
    ...definition,
  };
}

export function defineHostCapabilities<const Definitions extends Record<string, HostCapabilityDefinition<any, any>>>(
  definitions: Definitions,
): Array<{
  readonly [Id in keyof Definitions & string]: HostCapabilityHandler<
    HostCapabilityInput<Definitions[Id]>,
    HostCapabilityResult<Definitions[Id]>
  > & { readonly id: Id };
}[keyof Definitions & string]> {
  return Object.entries(definitions).map(([id, definition]) =>
    defineHostCapability(id, definition as HostCapabilityDefinition)
  ) as Array<{
    readonly [Id in keyof Definitions & string]: HostCapabilityHandler<
      HostCapabilityInput<Definitions[Id]>,
      HostCapabilityResult<Definitions[Id]>
    > & { readonly id: Id };
  }[keyof Definitions & string]>;
}

type HostCapabilityInput<Definition> =
  Definition extends HostCapabilityDefinition<infer Input, any> ? Input : unknown;

type HostCapabilityResult<Definition> =
  Definition extends HostCapabilityDefinition<any, infer Result> ? Result : unknown;
