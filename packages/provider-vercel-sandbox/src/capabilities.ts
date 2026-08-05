export const SSH_CAPABILITY_ID = "ssh";

export const SSH_CAPABILITY_SCHEMA_HASH =
  "sha256:7881e61b265447ca88ac6d1431b211e59e9f94b74ac65d71a51453534b362d9a";

export const SSH_CAPABILITY = {
  id: SSH_CAPABILITY_ID,
  schemaHash: SSH_CAPABILITY_SCHEMA_HASH,
} as const;

export type VercelSandboxSshInput = {
  provider: "vercel-sandbox";
  sandbox: string;
  title?: string;
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
  return {
    provider: "vercel-sandbox",
    sandbox: value.sandbox.trim(),
    ...(value.title?.trim() ? { title: value.title.trim() } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
