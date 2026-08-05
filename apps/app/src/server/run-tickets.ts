import { createHmac, timingSafeEqual } from "node:crypto";

const RUN_SOCKET_TICKET_TTL_MS = 5 * 60_000;

export type RunSocketClaims = {
  runId: string;
  userId: string;
  role: "producer" | "viewer";
  expiresAt: number;
};

export function createRunSocketUrl(
  requestUrl: string,
  claims: Omit<RunSocketClaims, "expiresAt">,
): string {
  const url = new URL("/api/ws", requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", signRunSocketTicket({
    ...claims,
    expiresAt: Date.now() + RUN_SOCKET_TICKET_TTL_MS,
  }));
  return url.toString();
}

export function verifyRunSocketTicket(ticket: string): RunSocketClaims {
  const [encoded, signature] = ticket.split(".");
  if (!encoded || !signature) throw new Error("Invalid run socket ticket");
  const expected = signatureFor(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid run socket ticket");
  }
  const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  if (!isClaims(value) || value.expiresAt < Date.now()) throw new Error("Expired run socket ticket");
  return value;
}

function signRunSocketTicket(claims: RunSocketClaims): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${signatureFor(encoded)}`;
}

function signatureFor(encoded: string): string {
  return createHmac("sha256", ticketSecret()).update(encoded).digest("base64url");
}

function ticketSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV !== "production") return "stoke-development-only-secret-change-me";
  throw new Error("BETTER_AUTH_SECRET is not configured");
}

function isClaims(value: unknown): value is RunSocketClaims {
  return typeof value === "object" && value !== null &&
    "runId" in value && typeof value.runId === "string" &&
    "userId" in value && typeof value.userId === "string" &&
    "role" in value && (value.role === "producer" || value.role === "viewer") &&
    "expiresAt" in value && typeof value.expiresAt === "number";
}
