import type {
  RuntimeControlOperation,
  RuntimeControlWorkspace,
} from "@freestyle-sh/fdev-runtime-client";

export type OperationInputPrompt = {
  inputText(input: { name: string; description?: string; defaultValue?: string }): Promise<string | undefined>;
  confirm(input: { name: string; description?: string; defaultValue?: boolean }): Promise<boolean | undefined>;
  pickWorkspace(input: { name: string; description?: string; workspaces: RuntimeControlWorkspace[] }): Promise<RuntimeControlWorkspace | undefined>;
};

type JsonSchemaRecord = Record<string, unknown> & {
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
};

type JsonSchemaProperty = Record<string, unknown> & {
  type?: string;
  description?: string;
  default?: unknown;
};

export async function collectOperationInput(
  operation: RuntimeControlOperation,
  workspaces: RuntimeControlWorkspace[],
  prompt: OperationInputPrompt,
): Promise<Record<string, unknown> | undefined> {
  const schema = asInputSchema(operation.inputSchema);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const input: Record<string, unknown> = {};

  for (const [name, property] of orderedProperties(operation, properties)) {
    if (isWorkspaceInput(property)) {
      const workspace = await prompt.pickWorkspace({
        name,
        description: property.description,
        workspaces,
      });
      if (!workspace && required.has(name)) return undefined;
      if (workspace) input[name] = workspace.name;
      continue;
    }

    if (property.type === "boolean") {
      const confirmed = await prompt.confirm({
        name,
        description: property.description,
        defaultValue: typeof property.default === "boolean" ? property.default : false,
      });
      if (confirmed === undefined && required.has(name)) return undefined;
      if (confirmed !== undefined) input[name] = confirmed;
      continue;
    }

    const value = await prompt.inputText({
      name,
      description: property.description,
      defaultValue: typeof property.default === "string" ? property.default : undefined,
    });
    if ((value === undefined || value === "") && required.has(name)) return undefined;
    if (value !== undefined && value !== "") input[name] = coerceTextInput(value, property.type);
  }

  return input;
}

function orderedProperties(
  operation: RuntimeControlOperation,
  properties: Record<string, JsonSchemaProperty>,
): Array<[string, JsonSchemaProperty]> {
  const cliOrder = [
    ...[...(operation.cli?.positionals ?? [])].sort((a, b) => a.index - b.index).map((item) => item.name),
    ...(operation.cli?.options ?? []).map((item) => item.name),
  ];
  const seen = new Set<string>();
  const ordered: Array<[string, JsonSchemaProperty]> = [];
  for (const name of cliOrder) {
    const property = properties[name];
    if (!property || seen.has(name)) continue;
    seen.add(name);
    ordered.push([name, property]);
  }
  for (const entry of Object.entries(properties)) {
    if (seen.has(entry[0])) continue;
    ordered.push(entry);
  }
  return ordered;
}

function asInputSchema(value: unknown): JsonSchemaRecord {
  return isRecord(value) ? value as JsonSchemaRecord : {};
}

function isWorkspaceInput(property: JsonSchemaProperty): boolean {
  const fdevInput = property["x-fdev-input"];
  return isRecord(fdevInput) && fdevInput.kind === "workspace";
}

function coerceTextInput(value: string, type: string | undefined): unknown {
  if (type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${value} is not a number`);
    return parsed;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
