export const VSCODE_OPEN_CAPABILITY_ID = "vscode.open";
export const VSCODE_OPEN_CAPABILITY_SCHEMA_HASH =
  "sha256:d0140ef3083320a8a64e58a3e55101001e45cbea3570872d689d15a68dac30e4";

export const VSCODE_OPEN_CAPABILITY = {
  id: VSCODE_OPEN_CAPABILITY_ID,
  schemaHash: VSCODE_OPEN_CAPABILITY_SCHEMA_HASH,
} as const;

export type VscodeOpenInput = { authority: string; path?: string };

export function parseVscodeOpenInput(value: unknown): VscodeOpenInput {
  if (!isRecord(value) || typeof value.authority !== "string" || !value.authority.trim()) {
    throw new Error("vscode.open requires an SSH authority");
  }
  const authority = value.authority.trim();
  if (/\s|[\r\n]/.test(authority)) throw new Error("vscode.open received an invalid SSH authority");
  if (value.path !== undefined && (typeof value.path !== "string" || !value.path.startsWith("/"))) {
    throw new Error("vscode.open path must be an absolute remote path");
  }
  return { authority, ...(typeof value.path === "string" ? { path: value.path } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
