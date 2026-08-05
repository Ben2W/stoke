export const SSH_CAPABILITY_ID = "ssh";

export const SSH_CAPABILITY_SCHEMA_HASH =
  "sha256:5d44056b5824c2a181a6208048566625b276a9713b0033f3347fd0f43d15b527";

export const SSH_CAPABILITY = {
  id: SSH_CAPABILITY_ID,
  schemaHash: SSH_CAPABILITY_SCHEMA_HASH,
} as const;

export type VercelSandboxSshInput = {
  provider: "vercel-sandbox";
  sandbox: string;
  title?: string;
  cwd?: string;
};

export function parseVercelSandboxSshInput(value: unknown): VercelSandboxSshInput {
  if (!isRecord(value)) throw new Error("ssh requires an object input");
  if (value.provider !== "vercel-sandbox") {
    throw new Error('ssh provider must be "vercel-sandbox"');
  }
  if (typeof value.sandbox !== "string" || !value.sandbox.trim()) {
    throw new Error("ssh sandbox must be a non-empty string");
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    throw new Error("ssh title must be a string");
  }
  if (value.cwd !== undefined && (typeof value.cwd !== "string" || !value.cwd.trim())) {
    throw new Error("ssh cwd must be a non-empty string");
  }
  return {
    provider: "vercel-sandbox",
    sandbox: value.sandbox.trim(),
    ...(value.title?.trim() ? { title: value.title.trim() } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd.trim() } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
