export type OperationInput = Record<string, string | number | boolean>;

export function operationInputProperties(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema) || !isRecord(schema.properties)) return {};
  return schema.properties;
}

export function operationHasInput(schema: unknown): boolean {
  return Object.keys(operationInputProperties(schema)).length > 0;
}

export function operationRequiredFields(schema: unknown): Set<string> {
  if (!isRecord(schema) || !Array.isArray(schema.required)) return new Set();
  return new Set(schema.required.filter((item): item is string => typeof item === "string"));
}

export function initialOperationInput(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([name, rawProperty]) => {
    const property = isRecord(rawProperty) ? rawProperty : {};
    if (property.default !== undefined) return [name, property.default];
    return [name, property.type === "boolean" ? false : ""];
  }));
}

export function parseOperationInput(
  properties: Record<string, unknown>,
  required: Set<string>,
  values: Record<string, unknown>,
): OperationInput {
  const input: OperationInput = {};
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = isRecord(rawProperty) ? rawProperty : {};
    const value = values[name];
    if ((value === "" || value === undefined) && !required.has(name)) continue;
    if ((value === "" || value === undefined) && required.has(name)) {
      throw new Error(`${humanizeOperationInput(name)} is required.`);
    }
    if (property.type === "number" || property.type === "integer") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || (property.type === "integer" && !Number.isInteger(parsed))) {
        throw new Error(`${humanizeOperationInput(name)} must be a valid ${property.type}.`);
      }
      input[name] = parsed;
    } else if (property.type === "boolean") {
      input[name] = value === true;
    } else {
      input[name] = enumValue(property.enum, value) ?? String(value);
    }
  }
  return input;
}

export function humanizeOperationInput(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue(rawOptions: unknown, value: unknown): string | number | boolean | undefined {
  if (!Array.isArray(rawOptions)) return undefined;
  return rawOptions.filter(isScalar).find((option) => String(option) === String(value));
}
