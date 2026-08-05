import { createHmac, timingSafeEqual } from "node:crypto";

const SANDBOX_TICKET_TTL_MS = 10 * 60_000;
const PREFIX = "stoke_sandbox_";

export type SandboxTicketClaims = {
  userId: string;
  projectId: string;
  expiresAt: number;
};

export function createSandboxTicket(userId: string, projectId: string): string {
  const encoded = Buffer.from(JSON.stringify({
    userId,
    projectId,
    expiresAt: Date.now() + SANDBOX_TICKET_TTL_MS,
  } satisfies SandboxTicketClaims)).toString("base64url");
  return `${PREFIX}${encoded}.${signature(encoded)}`;
}

export function verifySandboxTicket(token: string): SandboxTicketClaims | undefined {
  if (!token.startsWith(PREFIX)) return undefined;
  const [encoded, provided] = token.slice(PREFIX.length).split(".");
  if (!encoded || !provided) return undefined;
  const expected = signature(encoded);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
  const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  if (!isClaims(value) || value.expiresAt < Date.now()) return undefined;
  return value;
}

function signature(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function secret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV !== "production") return "stoke-development-only-secret-change-me";
  throw new Error("BETTER_AUTH_SECRET is not configured");
}

function isClaims(value: unknown): value is SandboxTicketClaims {
  return typeof value === "object" && value !== null
    && "userId" in value && typeof value.userId === "string"
    && "projectId" in value && typeof value.projectId === "string"
    && "expiresAt" in value && typeof value.expiresAt === "number";
}
