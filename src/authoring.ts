import type {
  DevMachineDefinition,
  EnvResolver,
  MigrationDefinition,
  MigrationHandler,
  MigrationInstance,
} from "./types.ts";

export const env: EnvResolver = (name, fallback) => {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
};

export function defineMigration<Input = void>(
  name: string,
  handler: MigrationHandler<Input>,
): MigrationDefinition<Input> {
  const create = ((input?: Input) => ({
    kind: "fdev.migration" as const,
    name,
    input: input as Input,
    handler,
  })) as MigrationDefinition<Input>;

  Object.defineProperties(create, {
    kind: { value: "fdev.migration", enumerable: true },
    name: { value: name, enumerable: true },
    input: { value: undefined as Input, enumerable: true },
    handler: { value: handler, enumerable: true },
  });

  return create;
}

export function defineDevMachine<Options = undefined>(
  definition: Omit<DevMachineDefinition<Options>, "kind">,
): DevMachineDefinition<Options> {
  return {
    kind: "fdev.machine",
    ...definition,
  };
}

export function isMigration(value: unknown): value is MigrationInstance<any> {
  return Boolean(value && (typeof value === "object" || typeof value === "function") && (value as any).kind === "fdev.migration");
}

export function isDevMachine(value: unknown): value is DevMachineDefinition<any> {
  return Boolean(value && typeof value === "object" && (value as any).kind === "fdev.machine");
}
